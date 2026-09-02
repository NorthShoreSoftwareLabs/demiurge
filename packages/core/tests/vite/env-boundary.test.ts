import { describe, expect, it } from "vitest";
import {
  unstable_findEnvImportPath as findEnvImportPath,
  unstable_findEnvKeyReferences as findEnvKeyReferences,
  unstable_findServerEnvKeys as findServerEnvKeys,
  unstable_formatEnvBoundaryFindings as formatEnvBoundaryFindings,
} from "@demiurgejs/core/vite";
import { defineEnvSchema, env } from "@demiurgejs/core";

const keys = ["ANALYTICS_TOKEN", "SESSION_SECRET"];

describe("client environment references", () => {
  it("finds a member read", () => {
    expect(findEnvKeyReferences("const value = process.env.SESSION_SECRET;", keys))
      .toEqual(["SESSION_SECRET"]);
  });

  it("finds a computed read", () => {
    expect(findEnvKeyReferences('const value = values["SESSION_SECRET"];', keys))
      .toEqual(["SESSION_SECRET"]);
  });

  it("finds a destructured read", () => {
    expect(
      findEnvKeyReferences(
        "const { SESSION_SECRET: secret } = readEnv(schema);",
        keys,
      ),
    ).toEqual(["SESSION_SECRET"]);
  });

  it("finds an identifier that holds the value", () => {
    expect(findEnvKeyReferences("send(SESSION_SECRET);", keys))
      .toEqual(["SESSION_SECRET"]);
  });

  it("finds each declared variable one time", () => {
    const code = `const token = values.ANALYTICS_TOKEN;
const secret = values.SESSION_SECRET;
report(values.ANALYTICS_TOKEN);`;

    expect(findEnvKeyReferences(code, keys))
      .toEqual(["ANALYTICS_TOKEN", "SESSION_SECRET"]);
  });

  it("accepts an object key that declares the schema", () => {
    const code = `export const schema = defineEnvSchema({
  SESSION_SECRET: env.secret(),
});`;

    expect(findEnvKeyReferences(code, keys)).toEqual([]);
  });

  it("accepts an import and a re-export of the name", () => {
    const code = `import { SESSION_SECRET } from "./names";
export { SESSION_SECRET } from "./names";`;

    expect(findEnvKeyReferences(code, keys)).toEqual([]);
  });

  it("accepts a module that names no declared variable", () => {
    expect(findEnvKeyReferences("export const value = 1;", keys)).toEqual([]);
    expect(findEnvKeyReferences("export const value = 1;", [])).toEqual([]);
  });
});

describe("server environment keys", () => {
  it("keeps every variable that the browser does not receive", () => {
    const schema = defineEnvSchema({
      PUBLIC_API_URL: env.url({ client: true }),
      READ_LIMIT: env.integer(),
      SESSION_SECRET: env.secret(),
    });

    expect([...findServerEnvKeys(schema)]).toEqual([
      ["READ_LIMIT", { sensitive: false }],
      ["SESSION_SECRET", { sensitive: true }],
    ]);
    expect(findServerEnvKeys(undefined).size).toBe(0);
  });
});

describe("client environment import path", () => {
  const graph: Record<string, string[]> = {
    "client-entry": ["route"],
    other: [],
    route: ["helper", "other"],
    helper: ["session"],
    session: [],
  };
  const importsOf = (id: string) => graph[id] ?? [];

  it("gives the path from the entry to the module", () => {
    expect(findEnvImportPath("client-entry", "session", importsOf))
      .toEqual(["client-entry", "route", "helper", "session"]);
  });

  it("gives the entry itself", () => {
    expect(findEnvImportPath("route", "route", importsOf)).toEqual(["route"]);
  });

  it("gives no path for a module that the entry does not reach", () => {
    expect(findEnvImportPath("client-entry", "server-only", importsOf))
      .toBeUndefined();
  });
});

describe("client environment diagnostics", () => {
  it("names the variable, the module, and the import path", () => {
    const message = formatEnvBoundaryFindings([
      {
        code: "client-secret",
        importPath: ["client-entry.js", "routes/index.tsx", "lib/session.ts"],
        key: "SESSION_SECRET",
        module: "lib/session.ts",
      },
      {
        code: "client-server-only",
        importPath: ["client-entry.js", "routes/index.tsx"],
        key: "READ_LIMIT",
        module: "routes/index.tsx",
      },
    ]);

    expect(message).toContain("variable: SESSION_SECRET");
    expect(message).toContain("module: lib/session.ts");
    expect(message).toContain(
      "client-entry.js -> routes/index.tsx -> lib/session.ts",
    );
    expect(message).toContain("A secret variable never reaches the browser");
    expect(message).toContain("client: true");
  });
});
