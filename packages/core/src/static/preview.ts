import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import type {
  StaticOutputEntry,
  StaticOutputFileHeaderRule,
  StaticOutputManifest,
} from "./index";

const STATIC_MANIFEST_FILE = "demiurge-static-manifest.json";

export type StaticPreviewOptions = {
  host?: string;
  outDir: string;
  port?: number;
};

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function createStaticPreviewServer(
  options: StaticPreviewOptions,
): Promise<Server> {
  const root = resolve(options.outDir);
  const manifest = parseStaticManifest(
    await readFile(resolve(root, STATIC_MANIFEST_FILE), "utf8"),
  );
  const entries = new Map(
    manifest.entries.map((entry) => [entry.pathname, entry]),
  );
  const entriesByFile = new Map(
    manifest.entries.map((entry) => [entry.file, entry]),
  );
  const rules = manifest.fileHeaderRules.map((rule) => ({
    ...rule,
    expression: new RegExp(rule.pattern),
  }));

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { allow: "GET, HEAD" });
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://demiurge.local");
      let pathname: string;

      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        response.writeHead(400, {
          "content-type": "text/plain; charset=utf-8",
        });
        response.end("The request path is not valid UTF-8.");
        return;
      }

      const routePath = pathname.replace(/\/$/, "") || "/";
      const entry = entries.get(routePath);

      if (entry) {
        await writeEntry(root, entry, request.method, response);
        return;
      }

      const file = resolvePreviewFile(root, pathname);
      if (file) {
        try {
          const declaredFile = relative(root, file).split(sep).join("/");
          const declaredEntry = entriesByFile.get(declaredFile);
          if (declaredEntry) {
            await writeEntry(root, declaredEntry, request.method, response);
            return;
          }

          const body = await readFile(file);
          const type = contentTypes[extname(file).toLowerCase()];
          if (type) response.setHeader("content-type", type);

          const fileName = pathname.split("/").at(-1) ?? "";
          const rule = rules.find(({ expression }) => expression.test(fileName));
          applyHeaders(response, rule?.headers ?? {});
          response.writeHead(200);
          response.end(request.method === "HEAD" ? undefined : body);
          return;
        } catch (error) {
          if (!isMissingFile(error)) throw error;
        }
      }

      const fallback = entries.get("*");
      if (!fallback) {
        response.writeHead(404);
        response.end();
        return;
      }

      await writeEntry(root, fallback, request.method, response);
    } catch {
      response.writeHead(500, {
        "content-type": "text/plain; charset=utf-8",
      });
      response.end("Demiurge could not serve the static output.");
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(
      options.port ?? 4173,
      options.host ?? "localhost",
      () => {
        server.off("error", onError);
        resolvePromise();
      },
    );
  });

  return server;
}

async function writeEntry(
  root: string,
  entry: StaticOutputEntry,
  method: string | undefined,
  response: import("node:http").ServerResponse,
) {
  const file = resolveDeclaredFile(root, entry.file);
  const body = await readFile(file);
  applyHeaders(response, entry.headers);
  response.writeHead(entry.status);
  response.end(method === "HEAD" ? undefined : body);
}

function applyHeaders(
  response: import("node:http").ServerResponse,
  headers: Record<string, string>,
) {
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
}

function resolvePreviewFile(root: string, pathname: string) {
  if (pathname.endsWith("/")) return undefined;
  return resolveContained(root, `.${pathname}`);
}

function resolveDeclaredFile(root: string, file: string) {
  const resolved = resolveContained(root, file);
  if (!resolved) {
    throw new Error(`Static preview file is outside the output directory: ${JSON.stringify(file)}.`);
  }
  return resolved;
}

function resolveContained(root: string, file: string) {
  if (
    !file ||
    file.startsWith("/") ||
    file.startsWith("\\") ||
    file.split(/[\\/]/).includes("..")
  ) {
    return undefined;
  }
  const resolved = resolve(root, file);
  const pathFromRoot = relative(root, resolved);
  return pathFromRoot !== ".." &&
      !pathFromRoot.startsWith(`..${sep}`)
    ? resolved
    : undefined;
}

function parseStaticManifest(source: string): StaticOutputManifest {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("The static output manifest is not valid JSON.");
  }

  if (!isRecord(value) || value.adapter !== "static" || value.version !== 1) {
    throw new Error("The static output manifest has an unsupported format.");
  }
  if (!Array.isArray(value.entries) || !Array.isArray(value.fileHeaderRules)) {
    throw new Error("The static output manifest does not contain header rules and entries.");
  }

  const entries = value.entries.map(parseEntry);
  const fileHeaderRules = value.fileHeaderRules.map(parseRule);
  const pathnames = new Set<string>();
  for (const entry of entries) {
    if (pathnames.has(entry.pathname)) {
      throw new Error(`The static output manifest repeats pathname ${JSON.stringify(entry.pathname)}.`);
    }
    pathnames.add(entry.pathname);
  }

  return { adapter: "static", entries, fileHeaderRules, version: 1 };
}

function parseEntry(value: unknown): StaticOutputEntry {
  if (
    !isRecord(value) ||
    typeof value.file !== "string" ||
    typeof value.pathname !== "string" ||
    (value.status !== 200 && value.status !== 404) ||
    !isStringRecord(value.headers)
  ) {
    throw new Error("The static output manifest contains an invalid entry.");
  }
  resolveDeclaredFile("/demiurge-manifest-root", value.file);
  return {
    file: value.file,
    headers: value.headers,
    pathname: value.pathname,
    status: value.status,
  };
}

function parseRule(value: unknown): StaticOutputFileHeaderRule {
  if (
    !isRecord(value) ||
    typeof value.pattern !== "string" ||
    !isStringRecord(value.headers)
  ) {
    throw new Error("The static output manifest contains an invalid file header rule.");
  }
  try {
    new RegExp(value.pattern);
  } catch {
    throw new Error("The static output manifest contains an invalid file header pattern.");
  }
  return { headers: value.headers, pattern: value.pattern };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(
    (item) => typeof item === "string",
  );
}

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error &&
    (error.code === "EISDIR" || error.code === "ENOENT");
}
