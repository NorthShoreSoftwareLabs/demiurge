export type RequestConnectionMetadata = {
  clientIp: string;
};

const connectionMetadata = new WeakMap<Request, RequestConnectionMetadata>();

export function getRequestConnectionMetadata(request: Request) {
  return connectionMetadata.get(request);
}

// The Node adapter resolves the client address once, honoring `trustProxy`,
// and stores it as connection metadata. An application that needs to report
// that address reads it here. Re-deriving it from `X-Forwarded-For` itself
// would bypass the deployment's proxy-trust policy.
export function getRequestClientAddress(request: Request) {
  return connectionMetadata.get(request)?.clientIp;
}

export function setRequestConnectionMetadata(
  request: Request,
  metadata: RequestConnectionMetadata,
) {
  connectionMetadata.set(request, metadata);
}

export function copyRequestConnectionMetadata(from: Request, to: Request) {
  const metadata = connectionMetadata.get(from);

  if (metadata) {
    connectionMetadata.set(to, metadata);
  }
}
