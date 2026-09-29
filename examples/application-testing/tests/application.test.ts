import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertSecurity, createApplicationTest } from "@demiurgejs/core/testing";
import { createStaticOutputTest, verifyStaticOutput } from "@demiurgejs/core/static/testing";

const routes = {
  "./routes/@middleware.ts": () => import("../src/routes/@middleware"),
  "./routes/@not-found.tsx": () => import("../src/routes/@not-found"),
  "./routes/@policy.ts": () => import("../src/routes/@policy"),
  "./routes/index.tsx": () => import("../src/routes/index"),
  "./routes/messages.ts": () => import("../src/routes/messages"),
};
const temporaryDirectories: string[] = [];
const failOnApplicationError = (error: unknown) => {
  throw error;
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })
  ));
});

describe("application testing", () => {
  it("tests a page through the application request boundary", async () => {
    const response = await createApplicationTest({
      onError: failOnApplicationError,
      routes,
    }).request("/");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain("Application test fixture");
  });

  it("tests an action with a standard request", async () => {
    const form = new FormData();
    form.set("message", "saved");
    const response = await createApplicationTest({
      onError: failOnApplicationError,
      routes,
    }).request(new Request(
      "https://demiurge.test/messages",
      { body: form, method: "POST" },
    ));
    await expect(response.json()).resolves.toEqual({ message: "saved" });
  });

  it("observes middleware and policy behavior", async () => {
    const response = await createApplicationTest({
      onError: failOnApplicationError,
      routes,
    }).request("/");
    expect(response.headers.get("x-application-middleware")).toBe("active");
    await expect(assertSecurity(response, {
      csp: /default-src 'self'/,
      nonce: false,
    })).resolves.toBeUndefined();
  });

  it("inspects a generated static artifact", async () => {
    const root = await mkdtemp(join(tmpdir(), "demiurge-application-test-"));
    temporaryDirectories.push(root);
    const outDir = join(root, "dist");
    await mkdir(outDir);
    await writeFile(join(outDir, "index.html"), "client shell");
    const output = await createStaticOutputTest({
      outDir,
      onError: failOnApplicationError,
      routeSelection: "hybrid",
      routes,
    });
    expect(output.entry("/")?.file).toBe("index.html");
    const document = new TextDecoder().decode(await output.readFile("index.html"));
    expect(document).toContain("Application test fixture");
    await expect(verifyStaticOutput(outDir, output.manifest)).resolves.toBe(output.manifest);
  });
});
