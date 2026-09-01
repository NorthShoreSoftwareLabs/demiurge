import { execFileSync, spawn } from "node:child_process";
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
  version: "0.2.0-beta.3",
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

async function startPreview(command: string, args: string[], cwd: string) {
  const child = spawn(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });

  const origin = await new Promise<string>((resolvePromise, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("The packed preview did not start."));
    }, 10_000);
    timeout.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const match = chunk.match(/(http:\/\/[^\s]+)\./);
      if (match) {
        clearTimeout(timeout);
        resolvePromise(match[1]!);
      }
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(
        new Error(`The packed preview exited with code ${code}. ${errors}`),
      );
    });
  });

  return { child, origin };
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
      ["bin", "dist", "LICENSE", "package.json", "README.md"].includes(entry),
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
      "ioredis@^5.4.1",
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
  const installedBin = installedPackage.bin as
    | { demiurge?: string }
    | undefined;
  const installedDependencies = installedPackage.dependencies as
    | Record<string, string>
    | undefined;
  const installedPeerDependencies = installedPackage.peerDependencies as
    | Record<string, string>
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
  assert(installedBin?.demiurge === "./bin/demiurge.mjs", "Packed package is missing the Demiurge command.");
  assert(
    installedDependencies?.["path-to-regexp"] === "6.3.0",
    "Packed package must use the patched route pattern parser.",
  );
  assert(
    installedPeerDependencies?.["@vercel/routing-utils"] === undefined,
    "Packed package must not require @vercel/routing-utils.",
  );
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
      `import { createEncryptedCookieSession, createMemoryCacheStore, createMemorySessionStore, createMutationAction, createRequestHandler, createSecurityHeaders, createSessionManager, createSignedCookieSession, hydrateFileRouter, mutation, mutationInput, MutationSubmit, MutationValidationError, page, security, useMutationAction } from "@demiurgejs/core";`,
      `import { createNodeServer, nodeAdapter } from "@demiurgejs/core/node";`,
      `import { createEdgeAssetHandler, createEdgeRequestHandler, edgeAdapter, EdgeSharedStoreError } from "@demiurgejs/core/edge";`,
      `import { generateStaticOutput, staticAdapter } from "@demiurgejs/core/static";`,
      `import { createRedisCacheStore, createRedisSessionStore } from "@demiurgejs/core/redis";`,
      `import { Redis } from "ioredis";`,
      `import { createKvCacheStore, createKvSessionStore } from "@demiurgejs/core/kv";`,
      `import { verifyCacheStoreContract, verifyCacheStoreRefreshContract } from "@demiurgejs/core/data/testing";`,
      `import { verifySessionStoreContract } from "@demiurgejs/core/security/testing";`,
      `import { verifyAdapterContract } from "@demiurgejs/core/adapter/testing";`,
      `import { verifyDeploymentContract } from "@demiurgejs/core/deployment/testing";`,
      `import { unstable_createRouteManifest } from "@demiurgejs/core/internal/testing";`,
      `import { unstable_demiurge as demiurge } from "@demiurgejs/core/vite";`,
      `import { defineConfig } from "@demiurgejs/core/config";`,
      `for (const [name, value] of Object.entries({ createEdgeAssetHandler, createEdgeRequestHandler, createEncryptedCookieSession, createKvCacheStore, createKvSessionStore, createMemorySessionStore, createMutationAction, createNodeServer, createRedisCacheStore, createRedisSessionStore, createRequestHandler, createSessionManager, createSignedCookieSession, defineConfig, demiurge, generateStaticOutput, hydrateFileRouter, mutation, MutationSubmit, MutationValidationError, page, unstable_createRouteManifest, useMutationAction, verifyAdapterContract, verifyCacheStoreContract, verifyDeploymentContract, verifySessionStoreContract })) {`,
      `  if (typeof value !== "function") {`,
      `    throw new Error(\`Expected \${name} to be exported as a function.\`);`,
      `  }`,
      `}`,
      `if (typeof mutationInput.custom !== "function" || typeof mutationInput.form !== "function" || typeof mutationInput.formData !== "function" || typeof mutationInput.json !== "function" || typeof mutationInput.text !== "function") {`,
      `  throw new Error("Expected the packed mutation input helpers.");`,
      `}`,
      `if (nodeAdapter.name !== "node" || !nodeAdapter.capabilities.streaming) {`,
      `  throw new Error("Expected the packed Node adapter contract.");`,
      `}`,
      `if (staticAdapter.name !== "static" || !staticAdapter.capabilities.staticOutput) {`,
      `  throw new Error("Expected the packed static adapter contract.");`,
      `}`,
      `if (edgeAdapter.name !== "edge" || !edgeAdapter.capabilities.streaming || edgeAdapter.capabilities.sharedCache || edgeAdapter.capabilities.backgroundLifetime) {`,
      `  throw new Error("Expected the packed edge adapter contract.");`,
      `}`,
      `let edgeStoreFailure = "";`,
      `try {`,
      `  createEdgeRequestHandler({ rateLimitStore: "unavailable", routes: {} });`,
      `} catch (error) {`,
      `  edgeStoreFailure = error.message;`,
      `}`,
      `if (!edgeStoreFailure.includes("edge cacheStore is required")) {`,
      `  throw new Error("Expected the packed edge adapter to refuse a missing cache store.");`,
      `}`,
      `const packedEdgeAssets = createEdgeAssetHandler({ assets: { "/assets/app-abcdef12.js": { body: "export {};" } } });`,
      `const packedEdgeAsset = await packedEdgeAssets(new Request("https://packed.test/assets/app-abcdef12.js"));`,
      `if (packedEdgeAsset?.headers.get("cache-control") !== "public, max-age=31536000, immutable") {`,
      `  throw new Error("Expected the packed edge asset handler to serve from its map.");`,
      `}`,
      `if (!(new EdgeSharedStoreError("packed") instanceof Error)) {`,
      `  throw new Error("Expected the packed edge shared store error.");`,
      `}`,
      `const packedRedisClient = new Redis({ lazyConnect: true });`,
      `const packedRedisStore = createRedisCacheStore({ client: packedRedisClient });`,
      `if (typeof packedRedisStore.get !== "function" || typeof packedRedisStore.invalidateTags !== "function") {`,
      `  throw new Error("Expected the packed Redis cache store to implement the cache store contract shape.");`,
      `}`,
      `const packedNamespace = { app: "packed", environment: "test", schemaVersion: 1 };`,
      `const packedRedisSessions = createRedisSessionStore({ client: packedRedisClient, namespace: packedNamespace });`,
      `if (typeof packedRedisSessions.rotate !== "function") {`,
      `  throw new Error("Expected the packed Redis session store contract.");`,
      `}`,
      `let redisClientFailure = "";`,
      `try {`,
      `  createRedisCacheStore({});`,
      `} catch (error) {`,
      `  redisClientFailure = error.message;`,
      `}`,
      `if (!redisClientFailure.includes("requires an ioredis client")) {`,
      `  throw new Error("Expected the packed Redis cache store to refuse a missing client.");`,
      `}`,
      `packedRedisClient.disconnect();`,
      `const packedKvStore = createKvCacheStore({ namespace: { async delete() {}, async get() { return null; }, async list() { return { keys: [], list_complete: true }; }, async put() {} } });`,
      `if (typeof packedKvStore.get !== "function" || typeof packedKvStore.invalidateTags !== "function") {`,
      `  throw new Error("Expected the packed KV cache store to implement the cache store contract shape.");`,
      `}`,
      `const packedKvSessions = createKvSessionStore({ namespace: packedNamespace, store: { async atomic() { return true; }, async delete() {}, async get() { return null; }, async list() { return { keys: [], list_complete: true }; }, async put() {} } });`,
      `if (typeof packedKvSessions.rotate !== "function") {`,
      `  throw new Error("Expected the packed KV session store contract.");`,
      `}`,
      `let kvNamespaceFailure = "";`,
      `try {`,
      `  createKvCacheStore({});`,
      `} catch (error) {`,
      `  kvNamespaceFailure = error.message;`,
      `}`,
      `if (!kvNamespaceFailure.includes("requires an EdgeKvNamespace")) {`,
      `  throw new Error("Expected the packed KV cache store to refuse a missing namespace.");`,
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
      `const packedSessionEntries = new Map();`,
      `await verifySessionStoreContract((namespace) => createMemorySessionStore({ entries: packedSessionEntries, namespace }));`,
      `const packedSessionKey = { id: "packed", value: new Uint8Array(32).fill(19) };`,
      `const packedSignedSessions = createSignedCookieSession({ keys: [packedSessionKey] });`,
      `const packedEncryptedSessions = createEncryptedCookieSession({ keys: [packedSessionKey] });`,
      `const packedServerSessions = createSessionManager({ keys: [packedSessionKey], store: createMemorySessionStore({ namespace: packedNamespace }) });`,
      `if (packedSignedSessions.cookieName !== "__Host-session" || packedEncryptedSessions.cookieName !== "__Host-session") {`,
      `  throw new Error("Expected packed cookie session managers.");`,
      `}`,
      `if (packedServerSessions.cookieName !== "__Host-session") {`,
      `  throw new Error("Expected the packed server session manager.");`,
      `}`,
      `let adapterContractFailure = "";`,
      `try {`,
      `  await verifyAdapterContract(staticAdapter, {});`,
      `} catch (error) {`,
      `  adapterContractFailure = error.message;`,
      `}`,
      `if (!adapterContractFailure.includes('capability "staticOutput" is declared true')) {`,
      `  throw new Error("Expected the packed adapter contract suite to require a staticOutput probe.");`,
      `}`,
      `let deploymentContractFailure = "";`,
      `try {`,
      `  await verifyDeploymentContract({ clientAddress: false, readiness: false, repeatedHeaders: false, requestUrl: false, securityHeaders: false, sharedCache: false, staticAssets: false, streaming: true }, {});`,
      `} catch (error) {`,
      `  deploymentContractFailure = error.message;`,
      `}`,
      `if (!deploymentContractFailure.includes('capability "streaming" is declared true')) {`,
      `  throw new Error("Expected the packed deployment contract suite to require a streaming probe.");`,
      `}`,
      `console.log("pack consumer ok");`,
    ].join("\n"),
  );

  const output = run("node", ["check.js"], scratch);

  if (!output.includes("pack consumer ok")) {
    throw new Error("Packed consumer check did not run to completion.");
  }

  writeFileSync(
    join(scratch, "ssr-mutation-form.js"),
    [
      `import React from "react";`,
      `import { renderToStaticMarkup } from "react-dom/server";`,
      `import { Form, MutationSubmit, useMutationAction } from "@demiurgejs/core";`,
      `function PackedMutationForm() {`,
      `  const [, save] = useMutationAction({ route: "/items/[id]", method: "POST", path: { id: "packed" } }, undefined);`,
      `  const [, publish] = useMutationAction({ route: "/items/[id]", method: "POST", path: { id: "publish" } }, undefined);`,
      `  return React.createElement(Form, { action: save }, React.createElement("input", { name: "title" }), React.createElement(MutationSubmit, { formAction: publish }, "Publish"));`,
      `}`,
      `const html = renderToStaticMarkup(React.createElement(PackedMutationForm));`,
      `if (!html.includes('action="/items/packed"') || !html.includes('method="post"') || !html.includes('formAction="/items/publish"') || html.includes("React form unexpectedly submitted")) {`,
      `  throw new Error(\`Expected real mutation URLs in server HTML. \${html}\`);`,
      `}`,
      `console.log("packed mutation form SSR ok");`,
    ].join("\n"),
  );
  const mutationFormSsrOutput = run("node", ["ssr-mutation-form.js"], scratch);
  if (!mutationFormSsrOutput.includes("packed mutation form SSR ok")) {
    throw new Error("Packed mutation form SSR check did not run to completion.");
  }

  const cliHelp = run(
    "node",
    [join(installedRoot, "bin", "demiurge.mjs"), "--help"],
    scratch,
  );
  assert(cliHelp.includes("Build production output"), "Packed Demiurge command has no build help.");
  assert(
    cliHelp.includes("Start the development server"),
    "Packed Demiurge command has no development help.",
  );
  assert(
    cliHelp.includes("demiurge.config.ts"),
    "Packed Demiurge help does not name the configuration file.",
  );

  let missingConfigError = "";
  try {
    run("node", [join(installedRoot, "bin", "demiurge.mjs"), "build"], scratch);
  } catch (error) {
    missingConfigError = String(
      (error as { stderr?: string }).stderr ?? (error as Error).message,
    );
  }
  assert(
    missingConfigError.includes("demiurge.config.ts") &&
      missingConfigError.includes("npm create demiurge"),
    "The packed command does not report an absent configuration file.",
  );

  for (const file of [
    "dist/index.d.ts",
    "dist/cli.d.ts",
    "dist/config/index.d.ts",
    "dist/adapter/testing.d.ts",
    "dist/deployment/testing.d.ts",
    "dist/data/testing.d.ts",
    "dist/security/testing.d.ts",
    "dist/edge/index.d.ts",
    "dist/kv/index.d.ts",
    "dist/node/index.d.ts",
    "dist/redis/index.d.ts",
    "dist/static/index.d.ts",
    "dist/vite/index.d.ts",
  ]) {
    assert(existsSync(join(installedRoot, file)), `Packed tarball is missing ${file}.`);
  }

  mkdirSync(join(scratch, "src", "routes"), { recursive: true });
  writeFileSync(
    join(scratch, "src", "routes", "index.tsx"),
    [
      `import { createMutationAction, defineRoutePolicy, Form, mutation, mutationInput, MutationSubmit, MutationValidationError, page, security, tag, useMutationAction, type CacheKey, type CacheTag, type MutationAction, type MutationContext, type MutationFormAction, type MutationIdempotency, type MutationInput, type MutationNavigationState, type MutationOptions, type MutationResult, type MutationRevalidation, type MutationRevalidationDeclaration, type MutationValidation, type MutationValidationIssue, type RouteProps } from "@demiurgejs/core";`,
      `import { useFormStatus } from "react-dom";`,
      `export type PackedMutationContract = {`,
      `  context: MutationContext<FormData>;`,
      `  idempotency: MutationIdempotency<FormData>;`,
      `  input: MutationInput<FormData>;`,
      `  navigation: MutationNavigationState;`,
      `  options: MutationOptions<FormData>;`,
      `  result: MutationResult<{ saved: boolean }, "title" | "body">;`,
      `  revalidation: MutationRevalidation<FormData>;`,
      `  declaration: MutationRevalidationDeclaration;`,
      `  key: CacheKey;`,
      `  tag: CacheTag;`,
      `  validation: MutationValidation<"title" | "body">;`,
      `  issue: MutationValidationIssue<"title" | "body">;`,
      `  action: MutationAction<{ saved: boolean }, "title" | "body">;`,
      `  formAction: MutationFormAction<{ saved: boolean }, "title" | "body">;`,
      `};`,
      `type PackedValidationResult = Extract<PackedMutationContract["result"], { status: "invalid" }>;`,
      `type PackedValidationField = NonNullable<PackedValidationResult["validation"]["issues"][number]["path"][0]>;`,
      `const packedValidationField: PackedValidationField = "title";`,
      `// @ts-expect-error Mutation validation keeps the application field names.`,
      `const unknownValidationField: PackedValidationField = "slug";`,
      `void packedValidationField;`,
      `void unknownValidationField;`,
      `const packedRevalidation: MutationRevalidationDeclaration = { keys: [["post", 1]], tags: [tag("posts")] };`,
      `const packedContextRevalidation: MutationRevalidation<FormData, "/items/[id]"> = ({ input, path }) => ({`,
      `  keys: [["item", path.id, String(input.get("title"))]],`,
      `  tags: [tag("items")],`,
      `});`,
      `// @ts-expect-error Revalidation keys must use the CacheKey array shape.`,
      `const malformedRevalidation: MutationRevalidationDeclaration = { keys: ["item"] };`,
      `void packedRevalidation;`,
      `void packedContextRevalidation;`,
      `void malformedRevalidation;`,
      `export const policy = defineRoutePolicy({`,
      `  document: security.static({`,
      `    csp: {`,
      `      objectSrc: false,`,
      `      styleSrc: { replace: ["'unsafe-inline'"] },`,
      `    },`,
      `  }),`,
      `});`,
      `export const GET = page({`,
      `  render: { mode: "static" },`,
      `  view: PackedPage,`,
      `});`,
      `const packedSchema = {`,
      `  "~standard": {`,
      `    version: 1 as const,`,
      `    vendor: "packed-test",`,
      `    validate: (value: unknown) => ({ value: value as { title: string } }),`,
      `    types: undefined as unknown as { input: { title: FormDataEntryValue | null }; output: { title: string } },`,
      `  },`,
      `};`,
      `const packedMutation = mutation({`,
      `  input: mutationInput.form(packedSchema, (form) => ({ title: form.get("title") })),`,
      `  handler: ({ input }) => new Response(input.title, { status: 200 }),`,
      `});`,
      `void packedMutation;`,
      `const updatePackedItem = createMutationAction({ route: "/items/[id]", method: "PATCH", path: { id: "packed" } });`,
      `// @ts-expect-error Generated mutation types reject an unknown route.`,
      `createMutationAction({ route: "/missing", method: "POST" });`,
      `// @ts-expect-error Generated mutation types require dynamic path values.`,
      `createMutationAction({ route: "/items/[id]", method: "PATCH" });`,
      `// @ts-expect-error Generated mutation types reject a method that the route does not export.`,
      `createMutationAction({ route: "/items/[id]", method: "DELETE", path: { id: "packed" } });`,
      `function PackedPage(_props: RouteProps) {`,
      `  const [result, save] = useMutationAction({ route: "/items/[id]", method: "POST", path: { id: "packed" } }, undefined);`,
      `  const [, publish] = useMutationAction({ route: "/items/[id]", method: "POST", path: { id: "packed" } }, undefined);`,
      `  // @ts-expect-error Progressive HTML forms accept POST mutations only.`,
      `  useMutationAction({ route: "/items/[id]", method: "PATCH", path: { id: "packed" } }, undefined);`,
      `  const issues = result?.status === "invalid" ? result.validation.issues : [];`,
      `  const saved: boolean | undefined = result?.status === "success" ? result.data?.saved : undefined;`,
      `  const refresh: boolean | undefined = result?.status === "success" ? result.revalidate : undefined;`,
      `  return <main><Form action={save}><input name="title" /><PackedPendingButton /><MutationSubmit formAction={publish} name="intent" value="publish">Publish</MutationSubmit></Form><output>{issues.map((issue) => issue.message).join(", ")}{String(saved)}{String(refresh)}</output></main>;`,
      `}`,
      `function PackedPendingButton() {`,
      `  const { pending } = useFormStatus();`,
      `  return <button disabled={pending}>{pending ? "Saving" : "Save"}</button>;`,
      `}`,
    ].join("\n"),
  );
  mkdirSync(join(scratch, "src", "routes", "items"), { recursive: true });
  writeFileSync(
    join(scratch, "src", "routes", "items", "[id].tsx"),
    [
      `import { json, mutation, mutationInput, page, tag, type RouteProps } from "@demiurgejs/core";`,
      `const serverMutationHandlerSentinel = "DEMIURGE_PACKED_SERVER_MUTATION_HANDLER";`,
      `const serverMutationRevalidationSentinel = "DEMIURGE_PACKED_SERVER_MUTATION_REVALIDATION";`,
      `const serverMutationSecuritySentinel = "x-demiurge-packed-security-sentinel";`,
      `export const paths = () => [{ id: "packed" }];`,
      `export const GET = page({ render: { mode: "static" }, view: ({ path }: RouteProps<"/items/[id]">) => <main>{path.id}</main> });`,
      `export const PATCH = mutation({`,
      `  input: mutationInput.formData,`,
      `  handler: () => Response.json({ serverMutationHandlerSentinel }),`,
      `});`,
      `export const POST = mutation({`,
      `  revalidate: () => { void serverMutationRevalidationSentinel; return { keys: [["item", "packed"]], tags: [tag("items")] }; },`,
      `  revalidateRoute: true,`,
      `  security: { csrf: { header: serverMutationSecuritySentinel } },`,
      `  handler: () => json({ saved: true, serverMutationHandlerSentinel }),`,
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
    join(scratch, "demiurge.config.ts"),
    [
      `import { defineConfig } from "@demiurgejs/core/config";`,
      `export default defineConfig({`,
      `  routing: { typedRoutes: { outputFile: "src/route-manifest.d.ts" } },`,
      `});`,
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
        include: ["src", "demiurge.config.ts"],
      },
      null,
      2,
    ),
  );

  run("node", [join(installedRoot, "bin", "demiurge.mjs"), "build"], scratch);
  run("pnpm", ["exec", "tsc", "--noEmit"], scratch);
  const packedBrowserJavaScript = readdirSync(
    join(scratch, "dist", "assets"),
  )
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(join(scratch, "dist", "assets", file), "utf8"))
    .join("\n");
  assert(
    !packedBrowserJavaScript.includes("DEMIURGE_PACKED_SERVER_MUTATION_HANDLER"),
    "The browser output contains a server mutation handler.",
  );
  assert(
    !packedBrowserJavaScript.includes("DEMIURGE_PACKED_SERVER_MUTATION_REVALIDATION"),
    "The browser output contains a server mutation revalidation declaration.",
  );
  assert(
    !packedBrowserJavaScript.includes("x-demiurge-packed-security-sentinel"),
    "The browser output contains a server mutation security declaration.",
  );
  writeFileSync(
    join(scratch, "src", "routes", "items", "[id].tsx"),
    [
      `import { page, type RouteProps } from "@demiurgejs/core";`,
      `export const paths = () => [{ id: "packed" }];`,
      `export const GET = page({ render: { mode: "static" }, view: ({ path }: RouteProps<"/items/[id]">) => <main>{path.id}</main> });`,
    ].join("\n"),
  );
  writeFileSync(
    join(scratch, "src", "routes", "index.tsx"),
    [
      `import { defineRoutePolicy, page, security, type RouteProps } from "@demiurgejs/core";`,
      `export const policy = defineRoutePolicy({ document: security.static({ csp: { objectSrc: false, styleSrc: { replace: ["'unsafe-inline'"] } } }) });`,
      `export const GET = page({ render: { mode: "static" }, view: (_props: RouteProps) => <main>packed app</main> });`,
    ].join("\n"),
  );
  writeFileSync(
    join(scratch, "demiurge.config.ts"),
    [
      `import { defineConfig } from "@demiurgejs/core/config";`,
      `import { vercelStatic } from "@demiurgejs/core/static";`,
      `export default defineConfig({`,
      `  deployment: { static: { provider: vercelStatic() } },`,
      `  routing: { typedRoutes: { outputFile: "src/route-manifest.d.ts" } },`,
      `});`,
    ].join("\n"),
  );
  run(
    "node",
    [
      join(installedRoot, "bin", "demiurge.mjs"),
      "build",
      "--origin",
      "https://packed.example.test",
    ],
    scratch,
  );
  assert(
    existsSync(join(scratch, "dist", "index.html")) &&
      existsSync(
        join(scratch, "dist", "demiurge-static-manifest.json"),
      ),
    "The packed command could not build a clean external static app.",
  );
  assert(
    existsSync(join(scratch, ".vercel", "output", "config.json")) &&
      existsSync(join(scratch, ".vercel", "output", "static", "index.html")) &&
      !existsSync(
        join(
          scratch,
          ".vercel",
          "output",
          "static",
          "demiurge-static-manifest.json",
        ),
      ),
    "The packed command did not generate clean Vercel provider output.",
  );

  const preview = await startPreview(
    "node",
    [
      join(installedRoot, "bin", "demiurge.mjs"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ],
    scratch,
  );
  try {
    const response = await fetch(preview.origin);
    assert(response.status === 200, "The packed preview did not serve the static page.");
    assert(
      response.headers.has("content-security-policy"),
      "The packed preview did not apply the static policy.",
    );
  } finally {
    const exit = new Promise<void>((resolvePromise) => {
      preview.child.once("exit", () => resolvePromise());
    });
    preview.child.kill("SIGTERM");
    await exit;
  }

  const nodeOnlyScratch = mkdtempSync(join(tmpdir(), "demiurge-pack-node-"));
  try {
    writeFileSync(
      join(nodeOnlyScratch, "package.json"),
      JSON.stringify(
        {
          name: "demiurge-pack-node-consumer",
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
      ],
      nodeOnlyScratch,
    );
    assert(
      !existsSync(
        join(nodeOnlyScratch, "node_modules", "@vercel", "routing-utils"),
      ),
      "A Node-only consumer must not install @vercel/routing-utils.",
    );
    writeFileSync(
      join(nodeOnlyScratch, "check.js"),
      [
        `import { createNodeServer, nodeAdapter } from "@demiurgejs/core/node";`,
        `if (nodeAdapter.name !== "node" || typeof createNodeServer !== "function") {`,
        `  throw new Error("Expected the packed Node adapter contract without the Vercel peer.");`,
        `}`,
        `console.log("node-only pack consumer ok");`,
      ].join("\n"),
    );
    const nodeOnlyOutput = run("node", ["check.js"], nodeOnlyScratch);
    if (!nodeOnlyOutput.includes("node-only pack consumer ok")) {
      throw new Error("Node-only packed consumer check did not run to completion.");
    }
  } finally {
    rmSync(nodeOnlyScratch, { force: true, recursive: true });
  }

  console.log("pack artifact and external consumer tests passed");
} finally {
  rmSync(scratch, { force: true, recursive: true });
}
