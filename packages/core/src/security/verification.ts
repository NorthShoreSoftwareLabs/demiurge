import {
  assertAdapterCapabilities,
  type Adapter,
} from "../adapter";
import {
  createRouteManifest,
  isAttachedFileForRoute,
  type RouteManifest,
} from "../router";
import type {
  HttpMethod,
  PageRenderMode,
  ResponseCapability,
  RouteCapability,
  RouteModule,
} from "../route";
import { validateCorsPolicy } from "./cors";
import { createSecurityAudit } from "./audit";
import {
  createSecurityHeaders,
  mergeRoutePolicies,
  securityPolicyRequiresNonce,
} from "./policy";
import { validateRateLimitPolicy } from "./rate-limit";
import type { ScriptTag } from "../document";
import type { ContentSecurityPolicy, CspDirectiveValue } from "./types";

export type RouteModuleVerificationOptions = {
  adapter?: Adapter;
};

const httpMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const satisfies readonly HttpMethod[];

export function validateRouteModules(
  modules: Readonly<Record<string, RouteModule>>,
  options: RouteModuleVerificationOptions = {},
) {
  for (const [file, routeModule] of Object.entries(modules)) {
    validateModulePolicy(file, routeModule);

    for (const method of httpMethods) {
      const capability = routeModule[method];

      if (!capability || capability.kind === "page") {
        continue;
      }

      validateResponseCapability(file, method, capability, routeModule);
    }
  }

  // Verification has to build a manifest to resolve the policy cascade.
  // Returning it lets a caller that needs the same manifest reuse this one
  // instead of building a second identical copy.
  const manifest = createRouteManifest(
    Object.fromEntries(
      Object.entries(modules).map(([file, routeModule]) => [
        file,
        async () => routeModule,
      ]),
    ),
  );

  validatePagePolicies(manifest, modules, options.adapter);

  return manifest;
}

function validateModulePolicy(file: string, routeModule: RouteModule) {
  const rateLimit = routeModule.policy?.security?.rateLimit;

  if (rateLimit) {
    validateWithContext(file, "policy", "rate limit", () => {
      validateRateLimitPolicy(rateLimit);
    });
  }
}

function validateResponseCapability(
  file: string,
  method: HttpMethod,
  capability: ResponseCapability,
  routeModule: RouteModule,
) {
  if (capability.cors) {
    validateWithContext(file, method, "CORS", () => {
      validateCorsPolicy(capability.cors!);
      validateCorsMethods(file, method, capability.cors!.methods, routeModule);
    });
  }

  if (capability.security?.rateLimit) {
    validateWithContext(file, method, "rate limit", () => {
      validateRateLimitPolicy(capability.security!.rateLimit!);
    });
  }
}

function validateCorsMethods(
  file: string,
  exportName: HttpMethod,
  methods: readonly HttpMethod[] | undefined,
  routeModule: RouteModule,
) {
  if (!methods) {
    return;
  }

  for (const method of methods) {
    // Demiurge answers preflight itself, so a route never exports an OPTIONS
    // capability to serve one. Listing OPTIONS is a habit carried in from
    // other CORS configuration, and it changes nothing at request time.
    if (method === "OPTIONS") {
      continue;
    }

    if (responseCapabilityForMethod(routeModule, method)) {
      continue;
    }

    throw new Error(
      `Route ${JSON.stringify(file)} export ${exportName} allows CORS method ${method}, but the route does not export that response capability.`,
    );
  }
}

function responseCapabilityForMethod(
  routeModule: RouteModule,
  method: HttpMethod,
): ResponseCapability | undefined {
  const capability = method === "HEAD"
    ? routeModule.HEAD ?? routeModule.GET
    : routeModule[method];

  return isResponseCapability(capability) ? capability : undefined;
}

function isResponseCapability(
  capability: RouteCapability | undefined,
): capability is ResponseCapability {
  return Boolean(capability && capability.kind !== "page");
}

function validatePagePolicies(
  manifest: RouteManifest,
  modules: Readonly<Record<string, RouteModule>>,
  adapter: Adapter | undefined,
) {
  for (const route of manifest.routes) {
    const routeModule = modules[route.file];
    const page = routeModule?.GET;

    if (!page || page.kind !== "page") {
      continue;
    }

    const effectivePolicy = mergeRoutePolicies(
      ...manifest.policies
        .filter((policy) =>
          isAttachedFileForRoute(policy.fileSegments, route.fileSegments)
        )
        .map((policy) => modules[policy.file]?.policy),
      routeModule.policy,
    );

    validateEffectiveDocument(route.file, "GET", effectivePolicy, adapter);
    validateRenderModePolicy(
      route.file,
      page.render.mode,
      effectivePolicy.document,
    );
    validateStaticRouteScripts(
      route.file,
      "GET",
      effectivePolicy,
      [
        ...manifest.layouts
          .filter((layout) =>
            isAttachedFileForRoute(layout.fileSegments, route.fileSegments)
          )
          .map((layout) => modules[layout.file]?.scripts),
        routeModule.scripts,
      ],
    );
  }

  const fallbacks = [
    ...manifest.fallbacks.error,
    ...manifest.fallbacks.loading,
    ...manifest.fallbacks.notFound,
  ];

  for (const fallback of fallbacks) {
    const effectivePolicy = mergeRoutePolicies(
      ...manifest.policies
        .filter((policy) =>
          isAttachedFileForRoute(policy.fileSegments, fallback.fileSegments)
        )
        .map((policy) => modules[policy.file]?.policy),
      modules[fallback.file]?.policy,
    );

    validateEffectiveDocument(
      fallback.file,
      "policy",
      effectivePolicy,
      adapter,
    );
  }
}

function validateStaticRouteScripts(
  file: string,
  exportName: HttpMethod,
  effectivePolicy: ReturnType<typeof mergeRoutePolicies>,
  contributions: readonly (RouteModule["scripts"] | undefined)[],
) {
  const scripts = contributions.flatMap((contribution) =>
    Array.isArray(contribution) ? contribution : []
  );

  if (scripts.length === 0 || !effectivePolicy.document) {
    return;
  }

  const nonce = "startup-verification-nonce";
  const audit = createSecurityAudit({
    document: {
      headers: { nonce },
      policy: effectivePolicy.document,
      scripts: scripts.map((script) => ({
        ...script,
        nonce: securityPolicyRequiresNonce(effectivePolicy.document)
          ? nonce
          : script.nonce,
      })),
    },
  });
  const blocked = audit.findings.find((finding) =>
    finding.code === "csp-script-src-blocked"
  );

  if (!blocked) {
    validateScriptCspNeeds(
      file,
      exportName,
      effectivePolicy.document.csp,
      scripts,
    );
    return;
  }

  const script = scripts.find((candidate) =>
    blocked.message.includes(candidate.src)
  );
  const csp = createSecurityHeaders(effectivePolicy.document, { nonce })
    .get("content-security-policy") ?? "";
  const scriptDirective = csp.split("; ").find((directive) =>
    directive.startsWith("script-src ")
  ) ?? "default-src (script-src fallback)";

  throw new Error(
    `Route ${JSON.stringify(file)} export ${exportName} declares script ${JSON.stringify(script?.src)} that violates the effective ${scriptDirective} policy.`,
  );
}

// A vendor script also talks to its own backend. The script tag declares the
// directives that traffic needs. A route that contributes the script without
// widening the matching directive fails here, rather than failing silently in
// a browser the application does not own.
const scriptNeedDirectives = [
  { directive: "connectSrc", name: "connect-src", need: "connect" },
  { directive: "imgSrc", name: "img-src", need: "img" },
] as const;

function validateScriptCspNeeds(
  file: string,
  exportName: HttpMethod,
  csp: ContentSecurityPolicy | false | undefined,
  scripts: readonly ScriptTag[],
) {
  if (!csp) {
    return;
  }

  for (const scriptTag of scripts) {
    for (const { directive, name, need } of scriptNeedDirectives) {
      const required = scriptTag.needs?.[need] ?? [];

      if (required.length === 0) {
        continue;
      }

      const allowed = resolveCspDirectiveValue(csp[directive]) ??
        resolveCspDirectiveValue(csp.defaultSrc);

      // No directive and no default-src means the policy places no limit on
      // this resource type, so there is nothing left to satisfy.
      if (allowed === undefined) {
        continue;
      }

      for (const source of required) {
        if (Array.isArray(allowed) && cspSourceListAllows(allowed, source)) {
          continue;
        }

        throw new Error(
          `Route ${JSON.stringify(file)} export ${exportName} declares script ${JSON.stringify(scriptTag.src)} that needs ${name} ${source}, which the effective policy does not allow. Add ${source} to security.needs.${need} or to csp.${directive} for this route.`,
        );
      }
    }
  }
}

function cspSourceListAllows(sources: readonly string[], required: string) {
  if (sources.includes("'none'")) {
    return false;
  }

  if (sources.includes("*") || sources.includes(required)) {
    return true;
  }

  if (required.startsWith("'")) {
    return false;
  }

  return sources.some((source) => cspSourceMatchesOrigin(source, required));
}

function cspSourceMatchesOrigin(source: string, required: string) {
  if (source.startsWith("'")) {
    return false;
  }

  let requiredUrl: URL;

  try {
    requiredUrl = new URL(required);
  } catch {
    return false;
  }

  if (source === `${requiredUrl.protocol}`) {
    return true;
  }

  let sourceUrl: URL;

  try {
    sourceUrl = new URL(source);
  } catch {
    return false;
  }

  if (
    sourceUrl.protocol !== requiredUrl.protocol ||
    sourceUrl.port !== requiredUrl.port
  ) {
    return false;
  }

  if (sourceUrl.hostname.startsWith("*.")) {
    const suffix = sourceUrl.hostname.slice(1);

    return requiredUrl.hostname.endsWith(suffix) &&
      requiredUrl.hostname !== sourceUrl.hostname.slice(2);
  }

  return sourceUrl.hostname === requiredUrl.hostname;
}

function validateEffectiveDocument(
  file: string,
  exportName: HttpMethod | "policy",
  effectivePolicy: ReturnType<typeof mergeRoutePolicies>,
  adapter: Adapter | undefined,
) {
  validateWithContext(file, exportName, "effective document", () => {
    createSecurityHeaders(effectivePolicy.document ?? {}, {
      nonce: "startup-verification-nonce",
    });
  });

  if (!adapter || !securityPolicyRequiresNonce(effectivePolicy.document)) {
    return;
  }

  validateWithContext(file, exportName, "effective CSP", () => {
    assertAdapterCapabilities(adapter, ["nonceInjection"]);
  });
}

function validateRenderModePolicy(
  file: string,
  mode: PageRenderMode,
  policy: ReturnType<typeof mergeRoutePolicies>["document"],
) {
  if (mode === "static") {
    const nonceDirective = findNonceDirective(policy?.csp);

    if (nonceDirective) {
      throw new Error(
        `Route ${JSON.stringify(file)} uses render mode "static" with an effective ${nonceDirective} directive that depends on a CSP nonce. Use security.static() for static output or remove the nonce source from the document policy.`,
      );
    }

    return;
  }

  if (mode !== "streaming") {
    return;
  }

  const scriptPolicy = findEffectiveScriptPolicy(policy?.csp);

  if (!scriptPolicy || allowsStreamingInlineScripts(scriptPolicy.sources)) {
    return;
  }

  throw new Error(
    `Route ${JSON.stringify(file)} uses render mode "streaming" with an effective ${scriptPolicy.name} directive that does not allow React runtime inline payload scripts. Add a nonce placeholder or allow 'unsafe-inline' without nonce or hash sources.`,
  );
}

function findNonceDirective(policy: ContentSecurityPolicy | false | undefined) {
  if (!policy) {
    return undefined;
  }

  for (const [name, value] of Object.entries(policy)) {
    // SAFETY: the policy entries carry CSP directive values. The cast labels the entry value with the directive value type.
    const sources = resolveCspDirectiveValue(value as CspDirectiveValue);

    if (
      Array.isArray(sources) &&
      sources.some((source) => isNonceSource(source))
    ) {
      return toCspDirectiveName(name);
    }
  }

  return undefined;
}

function findEffectiveScriptPolicy(policy: ContentSecurityPolicy | false | undefined) {
  if (!policy) {
    return undefined;
  }

  const scriptSources = resolveCspDirectiveValue(policy.scriptSrc);

  if (Array.isArray(scriptSources)) {
    return { name: "script-src", sources: scriptSources };
  }

  const defaultSources = resolveCspDirectiveValue(policy.defaultSrc);

  if (Array.isArray(defaultSources)) {
    return { name: "default-src", sources: defaultSources };
  }

  return undefined;
}

function allowsStreamingInlineScripts(sources: readonly string[]) {
  if (sources.some((source) => isNoncePlaceholder(source))) {
    return true;
  }

  return sources.includes("'unsafe-inline'") &&
    !sources.some((source) => isNonceOrHashSource(source));
}

function isNonceSource(source: string) {
  return isNoncePlaceholder(source) || /^'nonce-[^']*'$/i.test(source);
}

function isNoncePlaceholder(source: string) {
  return source.includes("{nonce}");
}

function isNonceOrHashSource(source: string) {
  return /^'(?:nonce-|sha256-|sha384-|sha512-)/i.test(source);
}

function resolveCspDirectiveValue(value: CspDirectiveValue | undefined) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "replace" in value
  ) {
    return value.replace;
  }

  return value;
}

function toCspDirectiveName(name: string) {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function validateWithContext(
  file: string,
  exportName: HttpMethod | "policy",
  policyName: string,
  validate: () => void,
) {
  try {
    validate();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`Route ${JSON.stringify(file)} export `)
    ) {
      throw error;
    }

    const message = error instanceof Error
      ? error.message
      : `${policyName} validation failed.`;

    throw new Error(
      `Route ${JSON.stringify(file)} export ${exportName} has an invalid ${policyName} policy. ${message}`,
      { cause: error },
    );
  }
}
