import { describe, expect, it } from "vitest";
import {
  unstable_formatServerOnlyBoundaryFindings as formatServerOnlyBoundaryFindings,
  unstable_formatServerOnlyDevError as formatServerOnlyDevError,
  unstable_importsServerOnlyMarker as importsServerOnlyMarker,
} from "@demiurgejs/core/vite";

describe("server-only marker detection", () => {
  it("finds a static side-effect import", () => {
    expect(importsServerOnlyMarker('import "@demiurgejs/core/server-only";'))
      .toBe(true);
  });

  it("finds a default import", () => {
    expect(importsServerOnlyMarker('import x from "@demiurgejs/core/server-only";'))
      .toBe(true);
  });

  it("finds the bare community package specifier", () => {
    expect(importsServerOnlyMarker('import "server-only";')).toBe(true);
  });

  it("finds a wildcard re-export", () => {
    expect(importsServerOnlyMarker('export * from "@demiurgejs/core/server-only";'))
      .toBe(true);
  });

  it("finds a named re-export", () => {
    expect(importsServerOnlyMarker('export { x } from "server-only";'))
      .toBe(true);
  });

  it("finds a dynamic import", () => {
    expect(importsServerOnlyMarker('async function load() { await import("server-only"); }'))
      .toBe(true);
  });

  it("finds a dynamic import nested in other code", () => {
    const code = `export function readSecret() {
  return import("@demiurgejs/core/server-only").then(() => "value");
}`;

    expect(importsServerOnlyMarker(code)).toBe(true);
  });

  it("accepts a module that imports an unrelated specifier", () => {
    expect(importsServerOnlyMarker('import "./session";')).toBe(false);
  });

  it("accepts a string literal that names the marker without importing it", () => {
    expect(importsServerOnlyMarker('const value = "server-only";')).toBe(false);
    expect(importsServerOnlyMarker('report("@demiurgejs/core/server-only");'))
      .toBe(false);
  });

  it("accepts a dynamic import whose specifier is not a literal", () => {
    expect(importsServerOnlyMarker('const name = "server-only"; import(name);'))
      .toBe(false);
  });

  it("accepts a module with no import at all", () => {
    expect(importsServerOnlyMarker("export const value = 1;")).toBe(false);
  });
});

describe("server-only boundary diagnostics", () => {
  it("names the module and the import path from the client entry", () => {
    const message = formatServerOnlyBoundaryFindings([
      {
        importPath: ["client-entry.js", "routes/index.tsx", "lib/session.ts"],
        module: "lib/session.ts",
      },
    ]);

    expect(message).toContain("module: lib/session.ts");
    expect(message).toContain(
      "client-entry.js -> routes/index.tsx -> lib/session.ts",
    );
    expect(message).toContain("Keep this module out of client code");
  });

  it("names the module in the development server error", () => {
    const message = formatServerOnlyDevError("lib/session.ts");

    expect(message).toContain("lib/session.ts");
    expect(message).toContain("server-only");
  });
});
