import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Packs the library with the pnpm publication process. It installs the tarball
// in a temporary application and imports each declared entry point. No other
// repository check resolves `@demiurgejs/core` through node_modules. Therefore,
// only this check verifies package exports, files, and declarations from the
// consumer environment.

const packageDir = resolve("packages/core");
const scratch = mkdtempSync(join(tmpdir(), "demiurge-pack-"));
const expectedPackage = {
  author: "North Shore Software Labs",
  homepage: "https://github.com/NorthShoreSoftwareLabs/demiurge#readme",
  license: "MIT",
  name: "@demiurgejs/core",
  repository: "git+https://github.com/NorthShoreSoftwareLabs/demiurge.git",
  version: "0.1.1",
} as const;

function run(command: string, args: string[], cwd: string) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  run("pnpm", ["pack", "--pack-destination", scratch], packageDir);

  const tarball = readdirSync(scratch).find((file) => file.endsWith(".tgz"));

  if (!tarball) {
    throw new Error("pnpm pack produced no tarball.");
  }

  const tarballPath = join(scratch, tarball);
  const packedTopLevel = [...new Set(
    run("tar", ["-tzf", tarballPath], scratch)
      .split("\n")
      .map((entry) => entry.split("/")[1])
      .filter(Boolean),
  )];

  assert(
    packedTopLevel.every((entry) =>
      ["dist", "LICENSE", "package.json", "README.md"].includes(entry),
    ),
    `Packed package contains files outside the explicit artifact contract: ${packedTopLevel.join(", ")}`,
  );

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
    "pnpm",
    [
      "add",
      tarballPath,
      "react@^19.0.0",
      "react-dom@^19.0.0",
      "vite@^6.0.7",
      "typescript@^5.7.2",
      "@types/node@^22.13.0",
      "@types/react@^19.0.2",
      "@types/react-dom@^19.0.2",
      "@vitejs/plugin-react@^4.3.4",
    ],
    scratch,
  );

  const installedRoot = join(scratch, "node_modules", expectedPackage.name);
  const installedPackage = JSON.parse(
    readFileSync(join(installedRoot, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  const installedRepository = installedPackage.repository as
    | { directory?: string; type?: string; url?: string }
    | undefined;
  const installedBugs = installedPackage.bugs as { url?: string } | undefined;
  const installedEngines = installedPackage.engines as
    | { node?: string }
    | undefined;
  const installedPublishConfig = installedPackage.publishConfig as
    | { access?: string; provenance?: boolean }
    | undefined;

  assert(installedPackage.name === expectedPackage.name, "Packed package has the wrong name.");
  assert(installedPackage.version === expectedPackage.version, "Packed package has the wrong staged version.");
  assert(installedPackage.license === expectedPackage.license, "Packed package must declare the MIT license.");
  assert(installedPackage.author === expectedPackage.author, "Packed package is missing its author metadata.");
  assert(
    typeof installedPackage.description === "string" && installedPackage.description.length > 20,
    "Packed package is missing a useful description.",
  );
  assert(installedPackage.homepage === expectedPackage.homepage, "Packed package has the wrong homepage.");
  assert(installedBugs?.url === "https://github.com/NorthShoreSoftwareLabs/demiurge/issues", "Packed package is missing its issue tracker.");
  assert(installedRepository?.type === "git" && installedRepository.url === expectedPackage.repository, "Packed package is missing its Git repository.");
  assert(installedRepository.directory === "packages/core", "Packed package must identify its monorepo directory.");
  assert(installedEngines?.node === ">=22.13.0", "Packed package must declare the supported Node runtime.");
  assert(installedPublishConfig?.access === "public" && installedPublishConfig.provenance === true, "Packed package must require public provenance publication.");
  assert(Array.isArray(installedPackage.keywords) && installedPackage.keywords.includes("react"), "Packed package is missing npm discovery keywords.");

  const installedReadme = readFileSync(join(installedRoot, "README.md"), "utf8");
  const installedLicense = readFileSync(join(installedRoot, "LICENSE"), "utf8");
  const repositoryLicense = readFileSync(resolve("LICENSE"), "utf8");

  assert(installedReadme.includes("## Install"), "Packed README is missing installation documentation.");
  assert(installedReadme.includes("@demiurgejs/core/node"), "Packed README is missing the Node entry point.");
  assert(installedLicense === repositoryLicense, "Packed license differs from the repository license.");
  writeFileSync(
    join(scratch, "check.js"),
    [
      `import { createMemoryCacheStore, createRequestHandler, createSecurityHeaders, hydrateFileRouter, page, security } from "@demiurgejs/core";`,
      `import { createNodeServer, nodeAdapter } from "@demiurgejs/core/node";`,
      `import { generateStaticOutput, staticAdapter } from "@demiurgejs/core/static";`,
      `import { verifyCacheStoreContract, verifyCacheStoreRefreshContract } from "@demiurgejs/core/data/testing";`,
      `import { unstable_createRouteManifest } from "@demiurgejs/core/internal/testing";`,
      `import { demiurge } from "@demiurgejs/core/vite";`,
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
      `const packedPolicy = security.static({`,
      `  csp: {`,
      `    objectSrc: false,`,
      `    styleSrc: { replace: ["'unsafe-inline'"] },`,
      `  },`,
      `});`,
      `const packedCsp = createSecurityHeaders(packedPolicy).get("content-security-policy");`,
      `if (!packedCsp || packedCsp.includes("object-src") || !packedCsp.includes("style-src 'unsafe-inline'") || packedCsp.includes("style-src 'self'")) {`,
      `  throw new Error("Expected packed CSP replacement and removal behavior.");`,
      `}`,
      `await verifyCacheStoreContract(createMemoryCacheStore);`,
      `await verifyCacheStoreRefreshContract(createMemoryCacheStore);`,
      `console.log("pack consumer ok");`,
    ].join("\n"),
  );

  const output = run("node", ["check.js"], scratch);

  if (!output.includes("pack consumer ok")) {
    throw new Error("Packed consumer check did not run to completion.");
  }

  for (const file of [
    "dist/index.d.ts",
    "dist/data/testing.d.ts",
    "dist/node/index.d.ts",
    "dist/static/index.d.ts",
    "dist/vite/index.d.ts",
  ]) {
    assert(existsSync(join(installedRoot, file)), `Packed tarball is missing ${file}.`);
  }

  mkdirSync(join(scratch, "src", "routes"), { recursive: true });
  writeFileSync(
    join(scratch, "src", "routes", "index.tsx"),
    [
      `import { defineRoutePolicy, page, security, type RouteProps } from "@demiurgejs/core";`,
      `export const policy = defineRoutePolicy({`,
      `  document: security.static({`,
      `    csp: {`,
      `      objectSrc: false,`,
      `      styleSrc: { replace: ["'unsafe-inline'"] },`,
      `    },`,
      `  }),`,
      `});`,
      `export const GET = page({`,
      `  view: (_props: RouteProps) => <main>packed app</main>,`,
      `});`,
    ].join("\n"),
  );
  writeFileSync(
    join(scratch, "src", "routes", "@not-found.tsx"),
    [
      `export default function NotFound({ pathname }: { pathname: string }) {`,
      `  return <main>Nothing at {pathname}</main>;`,
      `}`,
    ].join("\n"),
  );
  writeFileSync(
    join(scratch, "vite.config.ts"),
    [
      `import react from "@vitejs/plugin-react";`,
      `import { defineConfig } from "vite";`,
      `import { demiurge } from "@demiurgejs/core/vite";`,
      `export default defineConfig({ plugins: [demiurge(), react()] });`,
    ].join("\n"),
  );
  writeFileSync(
    join(scratch, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          jsx: "react-jsx",
          lib: ["DOM", "ESNext"],
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          strict: true,
          target: "ES2022",
          types: ["node", "vite/client"],
        },
        include: ["src", "vite.config.ts"],
      },
      null,
      2,
    ),
  );

  run("pnpm", ["exec", "tsc", "--noEmit"], scratch);
  run("pnpm", ["exec", "vite", "build"], scratch);
  assert(
    existsSync(join(scratch, "dist", "index.html")),
    "The packed library could not build a clean external Vite app.",
  );

  console.log("pack artifact and external consumer tests passed");
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
