import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";

type Options = {
  scratch: string;
  deployment: string;
  results: Array<Record<string, unknown>>;
  save: () => Promise<void>;
  targetVersion: number;
};

export async function verifyBrowser({ scratch, deployment, results, save, targetVersion }: Options): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  let documentRequests = 0;
  let navigationRequests = 0;
  let assetRequests = 0;
  let sequence = 0;
  const responses: Array<Record<string, unknown>> = [];
  const page = await browser.newPage();
  try {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.route(`${deployment}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      assert.equal(url.origin, deployment);
      assert.equal(request.method(), "GET");
      if (url.pathname === "/favicon.ico") { await route.fulfill({ status: 204 }); return; }
      const id = sequence++;
      const headerFile = join(scratch, `browser-headers-${id}`);
      const bodyFile = join(scratch, `browser-body-${id}`);
      const navigation = request.headers()["x-demiurge-navigation"];
      const headers = `header = "x-vercel-skip-toolbar: 1"\n` + (navigation ? `header = "x-demiurge-navigation: ${navigation}"\n` : "");
      await command("vercel", ["curl", url.pathname + url.search, "--deployment", deployment, "--", "--silent", "--show-error", "--max-time", "30", "--dump-header", headerFile, "--output", bodyFile, "--config", "-"], scratch, headers);
      const rawHeaders = await readFile(headerFile, "utf8");
      const status = Number([...rawHeaders.matchAll(/^HTTP\/[^ ]+ (\d+)/gm)].at(-1)?.[1]);
      responses.push({ path: url.pathname, navigation: navigation ?? null, status });
      assert.equal(status, 200);
      const responseHeaders: Record<string, string> = {};
      for (const line of rawHeaders.split(/\r?\n/)) {
        const match = /^([^: ]+):\s*(.*)$/.exec(line);
        if (!match) continue;
        const name = match[1].toLowerCase();
        if (["set-cookie", "content-encoding", "content-length", "transfer-encoding", "connection"].includes(name)) continue;
        responseHeaders[name] = match[2];
      }
      if (navigation) navigationRequests++;
      else if (responseHeaders["content-type"]?.includes("text/html")) documentRequests++;
      else assetRequests++;
      await route.fulfill({ status, headers: responseHeaders, body: await readFile(bodyFile) });
    });
    await page.goto(`${deployment}/public/one`);
    await page.locator('main[data-hydrated="true"]').waitFor();
    const originalGeneration = await page.locator("main").getAttribute("data-generation");
    const contributionSnapshot = async () => {
      const version = Number(await page.locator("main").getAttribute("data-version"));
      const title = await page.title();
      const layoutDescription = await page.locator('meta[name="description"]').getAttribute("content");
      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      assert.ok(Number.isSafeInteger(version));
      assert.equal(title, `Metadata version ${version}`);
      assert.equal(layoutDescription, `Layout version ${version}`);
      assert.equal(canonical, `/proof-document-v${version}`);
      assert.equal(await page.locator("[data-proof-layout]").count(), 1);
      return { version, title, layoutDescription, canonical };
    };
    const initialContributions = await contributionSnapshot();
    await page.getByRole("button", { name: "Count 0" }).click();
    await page.getByRole("button", { name: "Count 1" }).waitFor();
    await page.getByRole("link", { name: "Other route" }).click();
    await page.locator('main[data-id="two"]').waitFor();
    await page.waitForURL(`${deployment}/public/two`);
    const targetContributions = await contributionSnapshot();
    assert.equal(targetContributions.version, targetVersion);
    assert.notEqual(targetContributions.version, initialContributions.version);
    await page.goBack();
    await page.locator('main[data-id="one"]').waitFor();
    const restoredContributions = await contributionSnapshot();
    assert.equal(documentRequests, 1);
    assert.ok(navigationRequests >= 2);
    assert.ok(assetRequests >= 1);
    assert.deepEqual(errors, []);
    results.push({ name: "browser-hydration-navigation", transport: "vercel-curl-bridge", documentRequests, navigationRequests, assetRequests, hydrated: true, interaction: true, history: true, documentContributions: true, initialVersion: initialContributions.version, targetVersion: targetContributions.version, restoredVersion: restoredContributions.version, initialContributions, targetContributions, restoredContributions, originalGeneration, errors });
    await save();
  } catch (error) {
    results.push({ name: "browser-failure", transport: "vercel-curl-bridge", errors, responses, pageUrl: page.url(), rootMarkup: await page.locator("#root").innerHTML().catch(() => null), scripts: await page.locator("script[src]").evaluateAll((scripts) => scripts.map((script) => script.getAttribute("src"))).catch(() => []) });
    await save();
    throw error;
  } finally {
    await browser.close();
  }
}

function command(binary: string, args: string[], cwd: string, input: string): Promise<void> {
  return new Promise((done, reject) => {
    const child = spawn(binary, args, { cwd, stdio: ["pipe", "ignore", "pipe"] });
    let errors = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { errors += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? done() : reject(new Error(`The browser transport failed: ${errors}`)));
    child.stdin.end(input);
  });
}
