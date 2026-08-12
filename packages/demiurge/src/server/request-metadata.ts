export type RequestConnectionMetadata = {
  clientIp: string;
};

const connectionMetadata = new WeakMap<Request, RequestConnectionMetadata>();

export function getRequestConnectionMetadata(request: Request) {
  return connectionMetadata.get(request);
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
