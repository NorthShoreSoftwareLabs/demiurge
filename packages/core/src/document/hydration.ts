import type { NavigationDocument } from "./navigation";

export type InitialRouteData = {
  data?: unknown;
  document?: NavigationDocument;
  error?: {
    detail?: string;
    title?: string;
  };
  hasData: boolean;
  navigation?: "document";
};

export const HYDRATION_DATA_ELEMENT_ID = "__demiurge_data";
export const HYDRATION_ROOT_ATTRIBUTE = "data-demiurge-hydrate";
// Marks a server document as a fallback, not a page. The client hydrates markup
// that it can reproduce. It replaces other markup. This attribute distinguishes
// a server 404 from a page that does not match the client manifest.
export const HYDRATION_FALLBACK_ATTRIBUTE = "data-demiurge-fallback";

export function serializeInitialRouteData(
  data: unknown,
  options: { navigation?: "document" } = {},
) {
  return escapeJsonScript(
    JSON.stringify({ data, hasData: true, ...options }),
  );
}

export function readInitialRouteData(source: Document) {
  const element = source.getElementById(HYDRATION_DATA_ELEMENT_ID);
  // TYPE-EVIDENCE: the tagName check confirms the element is a template element. The cast adds the template content property.
  const serialized = element?.tagName === "TEMPLATE"
    ? (element as HTMLTemplateElement).content.textContent
    : element?.textContent;

  if (!serialized) {
    return undefined;
  }

  try {
    // TYPE-EVIDENCE: the serialized value came from serializeInitialRouteData which emits an initial route data shape. The cast restores that shape after parsing.
    return JSON.parse(serialized) as InitialRouteData;
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
