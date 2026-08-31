export type ClientBuildManifest = {
  clientEntry: string;
  styles: string[];
};

/**
 * Read the browser build manifest that names the hashed client entry and the
 * stylesheet paths a rendered document must load.
 */
export function parseClientManifest(source: string): ClientBuildManifest {
  let value: unknown;

  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("The client build manifest is not valid JSON.");
  }

  if (
    !value ||
    typeof value !== "object" ||
    !("clientEntry" in value) ||
    typeof value.clientEntry !== "string" ||
    !("styles" in value) ||
    !Array.isArray(value.styles) ||
    !value.styles.every((style) => typeof style === "string")
  ) {
    throw new Error("The client build manifest has an unsupported format.");
  }

  return {
    clientEntry: value.clientEntry,
    // TYPE-EVIDENCE: the guard above proves every entry is a string. The cast records that proof for the return type.
    styles: value.styles as string[],
  };
}
