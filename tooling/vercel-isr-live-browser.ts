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
};

export async function verifyBrowser({ scratch, deployment, results, save }: Options): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const errors: string[] = [];
  let documentRequests = 0;
  let navigationRequests = 0;
  let assetRequests = 0;
  let sequence = 0;
  try {
    const page = await browser.newPage();
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
    await page.getByRole("button", { name: "Count 0" }).click();
    await page.getByRole("button", { name: "Count 1" }).waitFor();
    await page.getByRole("link", { name: "Other route" }).click();
    await page.locator('main[data-id="two"]').waitFor();
    await page.waitForURL(`${deployment}/public/two`);
    assert.match(await page.title(), /^Metadata version \d+$/);
    assert.equal(await page.locator("[data-proof-layout]").count(), 1);
    assert.match(await page.locator('meta[name="description"]').getAttribute("content") ?? "", /^Layout version \d+$/);
    assert.match(await page.locator('link[rel="canonical"]').getAttribute("href") ?? "", /^\/proof-document-v\d+$/);
    await page.goBack();
    await page.locator('main[data-id="one"]').waitFor();
    assert.equal(documentRequests, 1);
    assert.ok(navigationRequests >= 2);
    assert.ok(assetRequests >= 1);
    assert.deepEqual(errors, []);
    results.push({ name: "browser-hydration-navigation", transport: "vercel-curl-bridge", documentRequests, navigationRequests, assetRequests, hydrated: true, interaction: true, history: true, documentContributions: true, originalGeneration, errors });
    await save();
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
