export type InitialRouteData = {
  data?: unknown;
  hasData: boolean;
};

export const HYDRATION_DATA_ELEMENT_ID = "__demiurge_data";
export const HYDRATION_ROOT_ATTRIBUTE = "data-demiurge-hydrate";

export function serializeInitialRouteData(data: unknown) {
  return escapeJsonScript(
    JSON.stringify({ data, hasData: data !== undefined }),
  );
}

export function readInitialRouteData(source: Document) {
  const element = source.getElementById(HYDRATION_DATA_ELEMENT_ID);

  if (!element?.textContent) {
    return undefined;
  }

  try {
    return JSON.parse(element.textContent) as InitialRouteData;
  } catch (error) {
    throw new Error(
      "Demiurge could not parse the initial route data payload.",
      { cause: error },
    );
  }
}

function escapeJsonScript(value: string) {
  return value
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
