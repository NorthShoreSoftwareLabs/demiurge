import {
  createMemoryCache,
  serializeCacheKey,
  serializeCacheTag,
  type Cache,
  type CacheScope,
} from "../data";
import type { ResolvedMetadata, ScriptTag } from "../document";
import {
  findRouteMatch,
  isAttachedFileForRoute,
  isRouteGroupSegment,
  loadPageRoute,
  MalformedPathnameError,
  toRoutePattern,
  type RouteManifest,
} from "../router";
import type {
  HttpMethod,
  PageRenderMode,
  PathVars,
  RouteModule,
} from "../route";
import { loadInheritedRoutePolicy } from "../server";
import {
  createSecurityAudit,
  type CorsPolicy,
  type RoutePolicy,
  type SecurityAudit,
  type SecurityAuditFinding,
} from "../security";
import { createCspNonce, securityPolicyRequiresNonce } from "../security/policy";

// The development server reserves this path. The name matches the image
// optimizer path, so every framework endpoint keeps one prefix.
export const ROUTE_AUDIT_PATH = "/_demiurge/audit";

const supportedMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const satisfies readonly HttpMethod[];

export type RouteAuditCacheRead = {
  key: string;
  scope: CacheScope;
  staleWhileRevalidate?: string;
  tags: string[];
  ttl?: string;
};

export type RouteAuditScript = {
  findings: SecurityAuditFinding[];
  integrity?: string;
  nonce?: string;
  purpose?: string;
  src: string;
  strategy: string;
};

export type RouteAuditRoute = {
  file: string;
  groups: string[];
  layouts: string[];
  methods: HttpMethod[];
  middlewares: string[];
  params: PathVars;
  pattern: string;
  policies: string[];
  render?: PageRenderMode;
};

export type RouteAudit = {
  audit: SecurityAudit;
  cacheControl?: string;
  cacheReads: RouteAuditCacheRead[];
  kind: "page" | "resource" | "unmatched";
  metadata?: ResolvedMetadata;
  method: HttpMethod;
  nonce?: string;
  pathname: string;
  policy: RoutePolicy;
  route?: RouteAuditRoute;
  scripts: RouteAuditScript[];
};

export function isRouteAuditRequest(request: Request) {
  return new URL(request.url).pathname === ROUTE_AUDIT_PATH;
}

export async function createRouteAuditResponse(
  manifest: RouteManifest,
  request: Request,
) {
  const url = new URL(request.url);
  const report = await createRouteAudit(
    manifest,
    url.searchParams.get("path") || "/",
    request,
  );
  const json = url.searchParams.get("format") === "json";

  return new Response(
    json
      ? JSON.stringify(report, replaceUnserializableValue, 2)
      : renderRouteAuditDocument(report),
    {
      headers: {
        "cache-control": "no-store",
        // The panel is a side channel. It declares its own policy, so the
        // policy of the application stays unchanged. The panel runs no script.
        "content-security-policy":
          "default-src 'none'; base-uri 'none'; form-action 'self'; style-src 'unsafe-inline'",
        "content-type": json
          ? "application/json; charset=utf-8"
          : "text/html; charset=utf-8",
        "x-robots-tag": "noindex",
      },
    },
  );
}

export async function createRouteAudit(
  manifest: RouteManifest,
  target: string,
  request: Request,
): Promise<RouteAudit> {
  const origin = new URL(request.url).origin;
  const url = new URL(target, origin);
  const pathname = url.pathname;
  const routeRequest = new Request(url, { headers: request.headers });
  const routeMatch = matchRoute(manifest, pathname);

  if (!routeMatch) {
    const policy = await loadInheritedRoutePolicy(
      manifest,
      { fileSegments: [] },
      {},
      undefined,
    );

    return finishRouteAudit({
      cacheReads: [],
      kind: "unmatched",
      method: "GET",
      pathname,
      policy,
      request: routeRequest,
      scripts: [],
    });
  }

  const routeModule = await routeMatch.route.load();
  const method = selectMethod(routeModule);
  const capability = routeModule[method];
  const policy = await loadInheritedRoutePolicy(
    manifest,
    routeMatch.route,
    routeModule,
    capability,
  );
  const cacheReads: RouteAuditCacheRead[] = [];
  const page = capability?.kind === "page"
    ? await loadPageRoute(
      manifest,
      pathname,
      routeRequest,
      undefined,
      createRecordingCache(cacheReads),
    )
    : undefined;
  const match = page?.status === "ready" ? page.match : undefined;

  return finishRouteAudit({
    cacheReads,
    cors: capability && capability.kind !== "page"
      ? capability.cors
      : undefined,
    kind: capability?.kind === "page" ? "page" : "resource",
    metadata: match?.metadata,
    method,
    pathname,
    policy,
    request: routeRequest,
    route: {
      file: routeMatch.route.file,
      groups: routeMatch.route.fileSegments.filter(isRouteGroupSegment),
      layouts: manifest.layouts
        .filter((layout) => isAttachedFileForRoute(layout.fileSegments, routeMatch.route.fileSegments))
        .map((layout) => layout.file),
      methods: supportedMethods.filter((name) => routeModule[name]),
      middlewares: manifest.middlewares
        .filter((item) => isAttachedFileForRoute(item.fileSegments, routeMatch.route.fileSegments))
        .map((item) => item.file),
      params: routeMatch.path,
      pattern: toRoutePattern(routeMatch.route.segments),
      policies: manifest.policies
        .filter((item) => isAttachedFileForRoute(item.fileSegments, routeMatch.route.fileSegments))
        .map((item) => item.file),
      render: match?.render.mode,
    },
    scripts: match?.scripts ?? [],
  });
}

function finishRouteAudit(input: {
  cacheReads: RouteAuditCacheRead[];
  cors?: CorsPolicy;
  kind: RouteAudit["kind"];
  metadata?: ResolvedMetadata;
  method: HttpMethod;
  pathname: string;
  policy: RoutePolicy;
  request: Request;
  route?: RouteAuditRoute;
  scripts: readonly ScriptTag[];
}): RouteAudit {
  // The request handler renders the document policy for a page response only.
  // A resource route and an unmatched path therefore get no document headers
  // and no nonce.
  const document = input.kind === "page";
  // The document renderer gives each script the nonce of the document. The
  // audit reads the same values that the response carries.
  const nonce = document && securityPolicyRequiresNonce(input.policy.document)
    ? createCspNonce()
    : undefined;
  const scripts = input.scripts.map((script) => ({
    ...script,
    nonce: script.nonce ?? nonce,
  }));
  const auditOptions = {
    headers: { nonce, request: input.request },
    policy: input.policy.document ?? {},
    scriptDependencies: true,
  };
  const audit = createSecurityAudit({
    document: document ? { ...auditOptions, scripts } : undefined,
    route: {
      cors: input.cors,
      method: input.method,
      security: input.policy.security,
    },
  });

  return {
    audit,
    // A nonce makes a document unique for each response. The request handler
    // therefore replaces the cache directives of the application.
    cacheControl: nonce ? "private, no-store" : undefined,
    cacheReads: input.cacheReads,
    kind: input.kind,
    metadata: input.metadata,
    method: input.method,
    nonce,
    pathname: input.pathname,
    policy: input.policy,
    route: input.route,
    scripts: scripts.map((script) => ({
      // One audit for each script gives the status of that script alone. The
      // panel reads the same code path that the complete audit reads.
      findings: createSecurityAudit({
        document: { ...auditOptions, scripts: [script] },
      }).findings,
      integrity: script.integrity,
      nonce: script.nonce,
      purpose: script.purpose,
      src: script.src,
      strategy: script.strategy,
    })),
  };
}

function matchRoute(manifest: RouteManifest, pathname: string) {
  try {
    return findRouteMatch(manifest.routes, pathname);
  } catch (error) {
    if (error instanceof MalformedPathnameError) {
      return null;
    }

    throw error;
  }
}

function selectMethod(routeModule: RouteModule) {
  return supportedMethods.find((method) => routeModule[method]) ?? "GET";
}

function createRecordingCache(reads: RouteAuditCacheRead[]): Cache {
  const cache = createMemoryCache();

  return {
    get: async (request) => {
      reads.push({
        key: serializeCacheKey(request.key),
        scope: request.scope ?? "request",
        staleWhileRevalidate: formatDuration(request.staleWhileRevalidate),
        tags: (request.tags ?? []).map(serializeCacheTag),
        ttl: formatDuration(request.ttl),
      });

      return await cache.get(request);
    },
    invalidateKey: cache.invalidateKey,
    invalidateTags: cache.invalidateTags,
  };
}

function formatDuration(duration: number | string | undefined) {
  return duration === undefined ? undefined : String(duration);
}

// A policy can hold a function, and JSON does not keep one. The report names
// the value instead of dropping the key without a trace.
function replaceUnserializableValue(_key: string, value: unknown) {
  return typeof value === "function" ? "[function]" : value;
}

export function renderRouteAuditDocument(report: RouteAudit) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Demiurge route audit</title>
    <style>${panelStyles}</style>
  </head>
  <body>
    <h1>Demiurge route audit</h1>
    <form method="get" action="${ROUTE_AUDIT_PATH}">
      <label for="path">Path</label>
      <input id="path" name="path" value="${escapeHtml(report.pathname)}" />
      <button type="submit">Audit</button>
    </form>
${renderRouteSection(report)}
${renderFindingsSection(report.audit.findings)}
${renderHeadersSection(report.audit.headers)}
${renderPolicySection(report)}
${renderMetadataSection(report.metadata)}
${renderScriptsSection(report.scripts)}
${renderCacheSection(report)}
    <p class="footer">
      The development server serves this panel. A production build and a static
      export do not contain it.
    </p>
  </body>
</html>
`;
}

const panelStyles = `
  :root { color-scheme: light dark; }
  body {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    line-height: 1.5;
    margin: 0 auto;
    max-width: 60rem;
    padding: 2rem 1rem;
  }
  h1 { font-size: 1.25rem; }
  h2 { font-size: 1rem; margin-bottom: 0.25rem; }
  form { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
  input { flex: 1; padding: 0.25rem 0.5rem; }
  section { border-top: 1px solid currentColor; padding: 0.75rem 0; }
  table { border-collapse: collapse; width: 100%; }
  td, th { padding: 0.25rem 0.5rem 0.25rem 0; text-align: left; vertical-align: top; }
  th { white-space: nowrap; width: 12rem; }
  ul { margin: 0; padding-left: 1.25rem; }
  .empty { opacity: 0.7; }
  .error { font-weight: 700; }
  .footer { opacity: 0.7; }
`;

function renderRouteSection(report: RouteAudit) {
  if (!report.route) {
    return section(
      "Route",
      `<p class="empty">No route matches ${escapeHtml(report.pathname)}.</p>`,
    );
  }

  const route = report.route;

  return section(
    "Route",
    table([
      ["Pathname", escapeHtml(report.pathname)],
      ["Pattern", escapeHtml(route.pattern)],
      ["File", escapeHtml(route.file)],
      ["Kind", escapeHtml(report.kind)],
      ["Method", escapeHtml(report.method)],
      ["Methods", escapeHtml(route.methods.join(", "))],
      ["Render mode", route.render ? escapeHtml(route.render) : none()],
      ["Path values", entries(route.params)],
      ["Route groups", list(route.groups)],
      ["Layouts", list(route.layouts)],
      ["Policies", list(route.policies)],
      ["Middleware", list(route.middlewares)],
    ]),
  );
}

function renderFindingsSection(findings: SecurityAuditFinding[]) {
  if (findings.length === 0) {
    return section("Findings", `<p class="empty">No findings.</p>`);
  }

  return section(
    "Findings",
    `<ul>${findings.map(renderFinding).join("")}</ul>`,
  );
}

function renderFinding(finding: SecurityAuditFinding) {
  const className = finding.severity === "error" ? ' class="error"' : "";

  return `<li${className}>${escapeHtml(finding.severity)}: ${
    escapeHtml(finding.message)
  } <code>${escapeHtml(finding.code)}</code></li>`;
}

function renderHeadersSection(headers: Record<string, string>) {
  const names = Object.keys(headers).sort();

  if (names.length === 0) {
    return section(
      "Response headers",
      `<p class="empty">The response carries no document header.</p>`,
    );
  }

  return section(
    "Response headers",
    table(names.map((name) => [name, escapeHtml(headers[name])])),
  );
}

function renderPolicySection(report: RouteAudit) {
  const policy = {
    cors: report.audit.route?.cors,
    document: report.policy.document,
    security: report.policy.security,
  };

  return section(
    "Effective policy",
    `<pre>${
      escapeHtml(JSON.stringify(policy, replaceUnserializableValue, 2))
    }</pre>`,
  );
}

function renderMetadataSection(metadata: ResolvedMetadata | undefined) {
  if (!metadata) {
    return section("Metadata", `<p class="empty">No document metadata.</p>`);
  }

  return section(
    "Metadata",
    `<pre>${
      escapeHtml(JSON.stringify(metadata, replaceUnserializableValue, 2))
    }</pre>`,
  );
}

function renderScriptsSection(scripts: RouteAuditScript[]) {
  if (scripts.length === 0) {
    return section("Scripts", `<p class="empty">No contributed scripts.</p>`);
  }

  return section(
    "Scripts",
    scripts.map((script) =>
      table([
        ["Source", escapeHtml(script.src)],
        ["Strategy", escapeHtml(script.strategy)],
        ["Purpose", script.purpose ? escapeHtml(script.purpose) : none()],
        ["Integrity", script.integrity ? escapeHtml(script.integrity) : none()],
        ["Nonce", script.nonce ? "applied" : none()],
        [
          "Policy status",
          script.findings.length === 0
            ? "allowed"
            : `<ul>${script.findings.map(renderFinding).join("")}</ul>`,
        ],
      ])
    ).join(""),
  );
}

function renderCacheSection(report: RouteAudit) {
  const rows: Array<[string, string]> = [
    [
      "Response cache-control",
      report.cacheControl ? escapeHtml(report.cacheControl) : none(),
    ],
    ["Nonce", report.nonce ? "required" : none()],
  ];

  if (report.cacheReads.length === 0) {
    return section(
      "Cache behavior",
      `${table(rows)}<p class="empty">The request read no cache entry.</p>`,
    );
  }

  return section(
    "Cache behavior",
    `${table(rows)}${
      report.cacheReads.map((read) =>
        table([
          ["Key", escapeHtml(read.key)],
          ["Scope", escapeHtml(read.scope)],
          ["Time to live", read.ttl ? escapeHtml(read.ttl) : none()],
          [
            "Stale while revalidate",
            read.staleWhileRevalidate
              ? escapeHtml(read.staleWhileRevalidate)
              : none(),
          ],
          ["Tags", list(read.tags)],
        ])
      ).join("")
    }`,
  );
}

function section(title: string, body: string) {
  return `    <section>
      <h2>${escapeHtml(title)}</h2>
      ${body}
    </section>`;
}

function table(rows: Array<[string, string]>) {
  return `<table><tbody>${
    rows.map(([name, value]) =>
      `<tr><th scope="row">${escapeHtml(name)}</th><td>${value}</td></tr>`
    ).join("")
  }</tbody></table>`;
}

function list(values: readonly string[]) {
  if (values.length === 0) {
    return none();
  }

  return `<ul>${
    values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")
  }</ul>`;
}

function entries(values: PathVars) {
  return list(
    Object.entries(values).map(([name, value]) => `${name} = ${String(value)}`),
  );
}

function none() {
  return `<span class="empty">none</span>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}
