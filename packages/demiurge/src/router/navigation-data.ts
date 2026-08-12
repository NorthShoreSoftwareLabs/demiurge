import type { InitialRouteData } from "../document";

export const NAVIGATION_DATA_HEADER = "x-demiurge-navigation";
export const NAVIGATION_DATA_REQUEST = "data";
export const NAVIGATION_DATA_RESPONSE = "data";
export const NAVIGATION_ERROR_RESPONSE = "error";
export const NAVIGATION_NOT_FOUND_RESPONSE = "not-found";

export function isNavigationDataRequest(request: Request) {
  return request.headers.get(NAVIGATION_DATA_HEADER) === NAVIGATION_DATA_REQUEST;
}

export function createNavigationDataResponse(data: unknown) {
  return Response.json(
    { data, hasData: true } satisfies InitialRouteData,
    {
      headers: {
        "cache-control": "no-store",
        [NAVIGATION_DATA_HEADER]: NAVIGATION_DATA_RESPONSE,
        vary: NAVIGATION_DATA_HEADER,
      },
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
