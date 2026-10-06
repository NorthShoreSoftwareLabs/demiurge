import { getRequestClientAddress, json } from "@demiurgejs/core";

export const GET = json(({ request, url }) => ({
  clientAddress: getRequestClientAddress(request) ?? null,
  forwardedFor: request.headers.get("x-forwarded-for"),
  origin: url.origin,
}));
