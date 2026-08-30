// A local stand-in for a private object-storage bucket (S3, GCS, R2, ...).
// In production it never listens on a public interface. Only the CDN (read
// access) and the deploy pipeline (read and write access) may reach it. This
// is the same shape as an origin-access-control bucket policy.
//
// Two tokens model the two roles a real bucket policy grants separately.
// `readSecret` proves "an approved CDN origin". `writeSecret` proves "the
// deploy pipeline". A leaked read secret, from a compromised CDN edge, can
// never mutate the bucket. Directory listing is refused unconditionally, so
// an attacker who reaches the origin cannot enumerate objects even with a
// secret in hand.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export type BucketObject = {
  body: Buffer;
  etag: string;
  headers: Record<string, string>;
};

export type BucketServerOptions = {
  host?: string;
  port?: number;
  readSecret: string;
  writeSecret: string;
};

export async function startBucketServer(options: BucketServerOptions) {
  const objects = new Map<string, BucketObject>();
  const server = createServer((request, response) => {
    handleRequest(request, response, objects, options).catch((error) => {
      response.writeHead(500).end(String(error));
    });
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    server.once("error", rejectListening);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => {
      server.removeListener("error", rejectListening);
      resolveListening();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The bucket server did not bind to a network address.");
  }

  return {
    objectCount: () => objects.size,
    origin: `http://127.0.0.1:${address.port}`,
    stop: () => new Promise<void>((resolveStop) => server.close(() => resolveStop())),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  objects: Map<string, BucketObject>,
  options: BucketServerOptions,
) {
  const url = new URL(request.url ?? "/", "http://bucket.internal");
  const key = decodeURIComponent(url.pathname.replace(/^\/objects\//, ""));
  const providedSecret = request.headers["x-bucket-secret"];

  // A request for the bucket root, or for `/objects` with no key, is a
  // listing attempt. Refuse it before checking any secret: an authorized
  // caller never needs it, and an unauthorized one must not learn whether a
  // secret would have worked.
  if (!url.pathname.startsWith("/objects/") || key.length === 0) {
    response.writeHead(403, { "content-type": "text/plain" })
      .end("Directory listing is disabled on this origin.");
    return;
  }

  const canRead = providedSecret === options.readSecret || providedSecret === options.writeSecret;
  const canWrite = providedSecret === options.writeSecret;

  if (request.method === "GET" || request.method === "HEAD") {
    if (!canRead) {
      response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden.");
      return;
    }

    const object = objects.get(key);
    if (!object) {
      response.writeHead(404, { "content-type": "text/plain" }).end("Not found.");
      return;
    }

    response.writeHead(200, { ...object.headers, etag: object.etag });
    response.end(request.method === "HEAD" ? undefined : object.body);
    return;
  }

  if (request.method === "PUT") {
    if (!canWrite) {
      response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden.");
      return;
    }

    const body = await readBody(request);
    const headers: Record<string, string> = {};
    const contentType = request.headers["x-meta-content-type"];
    const cacheControl = request.headers["x-meta-cache-control"];
    if (typeof contentType === "string") headers["content-type"] = contentType;
    if (typeof cacheControl === "string") headers["cache-control"] = cacheControl;

    const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
    objects.set(key, { body, etag, headers });
    response.writeHead(201, { "content-type": "application/json" })
      .end(JSON.stringify({ etag }));
    return;
  }

  if (request.method === "DELETE") {
    if (!canWrite) {
      response.writeHead(403, { "content-type": "text/plain" }).end("Forbidden.");
      return;
    }

    objects.delete(key);
    response.writeHead(204).end();
    return;
  }

  response.writeHead(405, { "content-type": "text/plain" }).end("Method not allowed.");
}

function readBody(request: IncomingMessage) {
  return new Promise<Buffer>((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", rejectBody);
  });
}
