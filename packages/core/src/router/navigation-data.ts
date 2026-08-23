import type { InitialRouteData, NavigationDocument } from "../document";

export const NAVIGATION_DATA_HEADER = "x-demiurge-navigation";
export const NAVIGATION_DATA_REQUEST = "data";
export const NAVIGATION_DATA_RESPONSE = "data";
export const NAVIGATION_ERROR_RESPONSE = "error";
export const NAVIGATION_NOT_FOUND_RESPONSE = "not-found";

export function isNavigationDataRequest(request: Request) {
  return request.headers.get(NAVIGATION_DATA_HEADER) === NAVIGATION_DATA_REQUEST;
}

export function createNavigationDataResponse(
  data: unknown,
  options: {
    document?: NavigationDocument;
    error?: InitialRouteData["error"];
    headers?: HeadersInit;
    kind?: typeof NAVIGATION_DATA_RESPONSE |
      typeof NAVIGATION_ERROR_RESPONSE |
      typeof NAVIGATION_NOT_FOUND_RESPONSE;
    status?: number;
  } = {},
) {
  const headers = new Headers(options.headers);
  headers.set("cache-control", "no-store");
  headers.set(
    NAVIGATION_DATA_HEADER,
    options.kind ?? NAVIGATION_DATA_RESPONSE,
  );
  headers.append("vary", NAVIGATION_DATA_HEADER);

  return Response.json(
    {
      data,
      document: options.document,
      error: options.error,
      hasData: true,
    } satisfies InitialRouteData,
    {
      headers,
      status: options.status,
    },
  );
}

export function markNavigationResponse(
  response: Response,
  kind: typeof NAVIGATION_ERROR_RESPONSE | typeof NAVIGATION_NOT_FOUND_RESPONSE,
) {
  response.headers.set("cache-control", "no-store");
  response.headers.set(NAVIGATION_DATA_HEADER, kind);
  response.headers.append("vary", NAVIGATION_DATA_HEADER);
  return response;
}
