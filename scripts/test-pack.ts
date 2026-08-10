import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Packs the library the way npm would publish it, installs the tarball into a
// throwaway app, and imports every declared entry point. Nothing else in the
// repo resolves `demiurge` through node_modules, so this is the only check that
// exercises the package's `exports` map, its `files` list, and its emitted
// declarations the way a consumer would.

const packageDir = resolve("packages/demiurge");
const scratch = mkdtempSync(join(tmpdir(), "demiurge-pack-"));

function run(command: string, args: string[], cwd: string) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

try {
  run("npm", ["pack", "--pack-destination", scratch], packageDir);

  const tarball = readdirSync(scratch).find((file) => file.endsWith(".tgz"));

  if (!tarball) {
    throw new Error("npm pack produced no tarball.");
  }

  writeFileSync(
    join(scratch, "package.json"),
    JSON.stringify(
      {
        name: "demiurge-pack-consumer",
        private: true,
        type: "module",
        version: "0.0.0",
      },
      null,
      2,
    ),
  );

  run(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      join(scratch, tarball),
      "react@^19.0.0",
      "react-dom@^19.0.0",
      "vite@^6.0.7",
    ],
    scratch,
  );

  writeFileSync(
    join(scratch, "check.js"),
    [
      `import { createMemoryCacheStore, page, createRequestHandler, hydrateFileRouter } from "demiurge";`,
      `import { createNodeServer, nodeAdapter } from "demiurge/node";`,
      `import { generateStaticOutput, staticAdapter } from "demiurge/static";`,
      `import { verifyCacheStoreContract } from "demiurge/data/testing";`,
      `import { unstable_createRouteManifest } from "demiurge/internal/testing";`,
      `import { demiurge } from "demiurge/vite";`,
      `for (const [name, value] of Object.entries({ createNodeServer, createRequestHandler, demiurge, generateStaticOutput, hydrateFileRouter, page, unstable_createRouteManifest, verifyCacheStoreContract })) {`,
      `  if (typeof value !== "function") {`,
      `    throw new Error(\`Expected \${name} to be exported as a function.\`);`,
      `  }`,
      `}`,
      `if (nodeAdapter.name !== "node" || !nodeAdapter.capabilities.streaming) {`,
      `  throw new Error("Expected the packed Node adapter contract.");`,
      `}`,
      `if (staticAdapter.name !== "static" || !staticAdapter.capabilities.staticOutput) {`,
      `  throw new Error("Expected the packed static adapter contract.");`,
      `}`,
      `await verifyCacheStoreContract(createMemoryCacheStore);`,
      `console.log("pack consumer ok");`,
    ].join("\n"),
  );

  const output = run("node", ["check.js"], scratch);

  if (!output.includes("pack consumer ok")) {
    throw new Error("Packed consumer check did not run to completion.");
  }

  const types = run(
    "node",
    [
      "-e",
      `import("node:fs").then(({ existsSync }) => { for (const file of ["node_modules/demiurge/dist/index.d.ts", "node_modules/demiurge/dist/data/testing.d.ts"]) { if (!existsSync(file)) { throw new Error(\`Packed tarball is missing \${file}.\`); } } console.log("types ok"); })`,
    ],
    scratch,
  );

  if (!types.includes("types ok")) {
    throw new Error("Packed tarball did not ship declarations.");
  }

  console.log("pack smoke test passed");
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
