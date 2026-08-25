import { expect, test } from "./fixtures";

test("production SSR hydrates and navigates without a document reload", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  const routeDataRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("request", (request) => {
    if (request.headers()["x-demiurge-navigation"] === "data") {
      routeDataRequests.push(request.url());
    }
  });

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "SSR is running" })).toBeVisible();
  await page.getByRole("link", { name: "Browse items" }).click();
  await expect(page).toHaveURL("http://localhost:42177/items");
  await expect(page.getByRole("heading", { name: "Items" })).toBeVisible();
  await page.getByRole("link", { name: "alpha" }).click();
  await expect(page).toHaveURL("http://localhost:42177/items/alpha");
  await expect(page.getByRole("heading", { name: "Item: alpha" })).toBeVisible();
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page.getByRole("heading", { name: "SSR is running" })).toBeVisible();
  await expect(page.locator("[data-rendered-by=node]")).toBeVisible();

  const navigationCount = await page.evaluate(
    () => performance.getEntriesByType("navigation").length,
  );
  expect(navigationCount).toBe(1);
  expect(routeDataRequests).toContain("http://localhost:42177/");
  expect(pageErrors).toEqual([]);
});

test("production mutation forms use their typed redirect history operation", async ({
  page,
}) => {
  const actionRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["x-demiurge-mutation"] === "data;v=1") {
      actionRequests.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Test mutation forms" }).click();
  await expect(page).toHaveURL("http://localhost:42177/mutation-forms");

  await page.getByRole("button", { name: "Save with push" }).click();
  await expect(page).toHaveURL("http://localhost:42177/mutation-forms?result=push");
  await expect(page.getByText("Result: push")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:42177/mutation-forms");

  await page.getByRole("button", { name: "Save with replace" }).click();
  await expect(page).toHaveURL("http://localhost:42177/mutation-forms?result=replace");
  await expect(page.getByText("Result: replace")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL("http://localhost:42177/");
  expect(actionRequests).toEqual([
    "http://localhost:42177/mutation-forms",
    "http://localhost:42177/mutation-forms",
  ]);
});

test("React mutation forms preserve pending state, validation, files, and submitters", async ({
  page,
}) => {
  const mutationRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["x-demiurge-mutation"] === "data;v=1") {
      mutationRequests.push(request.url());
    }
  });

  await page.goto("/mutation-forms");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByLabel("React mutation validation")).toHaveText(
    "Enter a title.",
  );

  await page.getByLabel("Title").fill("Release notes");
  await page.getByLabel("Attachment").setInputFiles({
    buffer: Buffer.from("typed mutation"),
    mimeType: "text/plain",
    name: "notes.txt",
  });
  await page.getByRole("button", { name: "Publish draft" }).click();
  await expect(page.getByLabel("React form status")).toHaveText("pending");
  await expect(page).toHaveURL(
    "http://localhost:42177/mutation-forms?attachment=notes.txt&result=publish&title=Release+notes",
  );
  await expect(page.getByText("Result: publish")).toBeVisible();
  expect(mutationRequests).toEqual([
    "http://localhost:42177/mutation-forms",
    "http://localhost:42177/mutation-forms/publish",
  ]);
});

test("mutation forms keep native validation and multipart redirects without JavaScript", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:42177",
    javaScriptEnabled: false,
  });
  const page = await context.newPage();

  try {
    await page.goto("/mutation-forms");
    const validationResponse = await Promise.all([
      page.waitForResponse((response) =>
        response.url() === "http://localhost:42177/mutation-forms" &&
        response.request().method() === "POST"
      ),
      page.getByRole("button", { name: "Save draft" }).click(),
    ]).then(([response]) => response);
    expect(validationResponse.status()).toBe(400);
    expect(await validationResponse.json()).toMatchObject({
      type: "validation-error",
      validation: {
        issues: [{ path: ["title"] }],
      },
    });

    await page.goto("/mutation-forms");
    await page.getByLabel("Title").fill("Native release");
    await page.getByLabel("Attachment").setInputFiles({
      buffer: Buffer.from("native mutation"),
      mimeType: "text/plain",
      name: "native.txt",
    });
    await page.getByRole("button", { name: "Publish draft" }).click();
    await expect(page).toHaveURL(
      "http://localhost:42177/mutation-forms?attachment=native.txt&result=publish&title=Native+release",
    );
    await expect(page.getByText("Result: publish")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("mutation refresh retrieves authority without changing navigation state", async ({
  page,
}) => {
  const refreshUrl =
    "http://localhost:42177/mutation-forms?refreshKey=playwright-refresh";
  const routeDataRequests: string[] = [];
  page.on("request", (request) => {
    if (request.headers()["x-demiurge-navigation"] === "data") {
      routeDataRequests.push(request.url());
    }
  });

  await page.goto("/mutation-forms?refreshKey=playwright-refresh");
  const version = page.getByLabel("Server version");
  const optimisticVersion = page.getByLabel("Optimistic version");
  const initialVersion = Number(await version.textContent());
  const historyLength = await page.evaluate(() => window.history.length);
  const refresh = page.getByRole("button", { name: "Refresh server data" });

  await refresh.focus();
  await refresh.click();
  await expect(optimisticVersion).toHaveText(String(initialVersion + 1));
  await expect(page.getByLabel("Refresh form status")).toHaveText("pending");
  await expect(page.getByLabel("Mutation refresh pending")).toHaveText(
    "pending",
  );
  await expect(version).toHaveText(String(initialVersion + 1));
  await expect(page.getByLabel("Refresh form status")).toHaveText("idle");
  await expect(page.getByLabel("Mutation refresh pending")).toHaveText("idle");

  await expect(page).toHaveURL(refreshUrl);
  await expect(refresh).toBeFocused();
  expect(await page.evaluate(() => window.history.length)).toBe(historyLength);
  expect(routeDataRequests).toEqual([refreshUrl]);
});

test("optimistic mutation state rolls back after validation and expected failure", async ({
  page,
}) => {
  await page.goto("/mutation-forms?refreshKey=playwright-rollback");
  const authoritativeVersion = page.getByLabel("Server version");
  const optimisticVersion = page.getByLabel("Optimistic version");
  const initialVersion = Number(await authoritativeVersion.textContent());

  await page.getByRole("button", { name: "Reject optimistic change" }).click();
  await expect(optimisticVersion).toHaveText(String(initialVersion + 1));
  await expect(page.getByLabel("Mutation refresh result")).toHaveText("invalid");
  await expect(optimisticVersion).toHaveText(String(initialVersion));
  await expect(authoritativeVersion).toHaveText(String(initialVersion));

  await page.getByRole("button", { name: "Fail optimistic change" }).click();
  await expect(optimisticVersion).toHaveText(String(initialVersion + 1));
  await expect(page.getByLabel("Mutation refresh result")).toHaveText("failed");
  await expect(optimisticVersion).toHaveText(String(initialVersion));
  await expect(authoritativeVersion).toHaveText(String(initialVersion));
});

test("navigation cancels an obsolete mutation refresh", async ({ page }) => {
  const refreshUrl =
    "http://localhost:42177/mutation-forms?refreshKey=playwright-race";
  await page.goto(refreshUrl);
  const refreshRequest = page.waitForRequest((request) =>
    request.url() === refreshUrl &&
    request.headers()["x-demiurge-navigation"] === "data"
  );

  await page.getByRole("button", { name: "Refresh server data" }).click();
  const obsoleteRequest = await refreshRequest;
  const obsoleteRequestSettled = Promise.race([
    page.waitForResponse((response) => response.request() === obsoleteRequest),
    page.waitForEvent("requestfailed", {
      predicate: (request) => request === obsoleteRequest,
    }),
  ]);
  await page.getByRole("link", { name: "Home", exact: true }).click();

  await obsoleteRequestSettled;
  await expect(page).toHaveURL("http://localhost:42177/");
  await expect(page.getByRole("heading", { name: "SSR is running" })).toBeVisible();
});

test("accessible browser navigation commits status, focus, and hash behavior", async ({
  page,
}) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  const status = page.locator("[data-demiurge-navigation-status]");
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toHaveAttribute("aria-atomic", "true");
  await expect(status).toHaveText("");
  await expect(status).not.toHaveAttribute("style");
  await expect(page.locator("[data-demiurge-navigation-status-style]")).toHaveCount(1);

  await page.evaluate(() => {
    const status = document.querySelector("[data-demiurge-navigation-status]");
    let changes = 0;
    const observer = new MutationObserver((records) => {
      changes += records.length;
    });
    observer.observe(status!, { childList: true, characterData: true, subtree: true });
    (window as Window & { __demiurgeStatusChanges?: () => number }).__demiurgeStatusChanges =
      () => changes;
  });

  await page.getByRole("link", { name: "Test navigation" }).click();
  await expect(page).toHaveURL("http://localhost:42177/navigation");
  await expect(status).toHaveText("Navigation | Demiurge Node Server");
  await expect(page.locator("[data-route-focus-boundary]")).toBeFocused();
  expect(await page.evaluate(() =>
    (window as Window & { __demiurgeStatusChanges?: () => number })
      .__demiurgeStatusChanges?.(),
  )).toBe(1);

  await page.evaluate(() => {
    const sentinel = document.createElement("button");
    sentinel.id = "hash-focus-sentinel";
    sentinel.textContent = "Focus sentinel";
    document.body.append(sentinel);
    sentinel.focus();
    history.pushState(null, "", "/navigation#results");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL("http://localhost:42177/navigation#results");
  await expect(page.locator("#hash-focus-sentinel")).toBeFocused();
  await expect(status).toHaveText("Navigation | Demiurge Node Server");
  expect(await page.evaluate(() =>
    (window as Window & { __demiurgeStatusChanges?: () => number })
      .__demiurgeStatusChanges?.(),
  )).toBe(1);
});

test("browser navigation scrolls to the top after a committed route", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    document.body.style.minHeight = "2400px";
    window.scrollTo(0, 800);
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(800);
  await expect.poll(() => page.evaluate(() =>
    history.state?.__demiurge_scroll?.y,
  )).toBe(800);

  await page.getByRole("link", { name: "Test navigation" }).click();
  await expect(page).toHaveURL("http://localhost:42177/navigation");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test("SPA navigation keeps request callbacks server-only across query history", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  const routeDataRequests: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  page.on("request", (request) => {
    if (request.headers()["x-demiurge-navigation"] === "data") {
      routeDataRequests.push(request.url());
    }
  });

  await page.goto("/");
  await page.getByRole("link", { name: "Test navigation" }).click();
  await expect(page).toHaveURL("http://localhost:42177/navigation");
  await expect(page).toHaveTitle("Navigation | Demiurge Node Server");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Server-resolved browser navigation contributions.",
  );
  await expect(page.locator('link[rel="preconnect"][href="https://navigation.example.test"]'))
    .toHaveCount(1);
  await expect(page.locator('script[src="/navigation-contribution.js"]'))
    .toHaveCount(1);
  await expect(page.locator("html")).toHaveAttribute(
    "data-navigation-contribution",
    "loaded",
  );
  await expect(page.getByText("Query: none")).toBeVisible();
  await expect(page.getByText("Loaded by the server.")).toBeVisible();

  const repeatedQuery = page.getByRole("link", { name: "Repeated query" });
  await expect(repeatedQuery).toHaveAttribute("data-navigation-kind", "query");
  await expect(repeatedQuery).toHaveAttribute(
    "title",
    "Load the repeated query",
  );

  await repeatedQuery.click();
  await expect(page).toHaveURL(
    "http://localhost:42177/navigation?q=alpha&q=beta#results",
  );
  await expect(page.getByText("Query: alpha, beta")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL("http://localhost:42177/navigation");
  await expect(page.getByText("Query: none")).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(
    "http://localhost:42177/navigation?q=alpha&q=beta#results",
  );
  await expect(page.getByText("Query: alpha, beta")).toBeVisible();
  await expect(page).toHaveTitle("Navigation | Demiurge Node Server");
  await expect(page.locator('script[src="/navigation-contribution.js"]'))
    .toHaveCount(1);

  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveTitle("Demiurge Node Server");
  await expect(page.locator('link[rel="preconnect"][href="https://navigation.example.test"]'))
    .toHaveCount(0);
  await expect(page.locator('script[src="/navigation-contribution.js"]'))
    .toHaveCount(0);

  await page.goBack();
  await expect(page).toHaveURL(
    "http://localhost:42177/navigation?q=alpha&q=beta#results",
  );
  await expect(page).toHaveTitle("Navigation | Demiurge Node Server");
  await expect(page.locator('link[rel="preconnect"][href="https://navigation.example.test"]'))
    .toHaveCount(1);
  await expect(page.locator('script[src="/navigation-contribution.js"]'))
    .toHaveCount(1);

  await page.goForward();
  await expect(page).toHaveURL("http://localhost:42177/");
  await expect(page).toHaveTitle("Demiurge Node Server");
  await expect(page.locator('link[rel="preconnect"][href="https://navigation.example.test"]'))
    .toHaveCount(0);
  await expect(page.locator('script[src="/navigation-contribution.js"]'))
    .toHaveCount(0);

  const clientChunks = await page.evaluate(async () => {
    const urls = performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => new URL(url).pathname.endsWith(".js"));
    return await Promise.all([...new Set(urls)].map(async (url) =>
      await (await fetch(url)).text()
    ));
  });

  expect(routeDataRequests).toEqual(expect.arrayContaining([
    "http://localhost:42177/navigation",
    "http://localhost:42177/navigation?q=alpha&q=beta",
  ]));
  expect(routeDataRequests.filter((url) =>
    url === "http://localhost:42177/navigation"
  )).toHaveLength(2);
  expect(routeDataRequests.filter((url) =>
    url === "http://localhost:42177/navigation?q=alpha&q=beta"
  )).toHaveLength(3);
  expect(clientChunks.join("\n")).not.toContain(
    "DEMIURGE_SERVER_ONLY_NAVIGATION_CALLBACK",
  );
  expect(pageErrors).toEqual([]);
});

test("malformed encoded SPA paths render a controlled 400 route error", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByRole("link", { name: "Test malformed URL" }).click();

  await expect(page).toHaveURL("http://localhost:42177/items/%E0%A4%A");
  await expect(
    page.getByRole("heading", {
      name: "Something went wrong at /items/%E0%A4%A",
    }),
  ).toBeVisible();
  await expect(page.getByText("400", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("strict CSP and browser security headers are enforced", async ({ page }) => {
  const response = await page.goto("/");
  const headers = response?.headers() ?? {};
  const csp = headers["content-security-policy"];

  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  expect(headers["cross-origin-resource-policy"]).toBe("same-origin");
  expect(headers["permissions-policy"]).toContain("camera=()");
  expect(headers["cache-control"]).toBe("private, no-store");
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).toContain("upgrade-insecure-requests");
  expect(csp).not.toContain("'unsafe-inline'");
  await expect(page.getByRole("heading", { name: "SSR is running" }))
    .toBeVisible();
});

test("production renders an app-owned 404 document", async ({ page }) => {
  const response = await page.goto("/missing-browser-route");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "No route at /missing-browser-route" }),
  ).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Demiurge Node Server");
});

test("the Node adapter preserves repeated secure cookie headers", async ({
  context,
  page,
}) => {
  const result = await page.goto("/api/cookies");

  expect(result?.status()).toBe(200);
  const cookies = await context.cookies("http://localhost:42177/");
  const session = cookies.find((cookie) => cookie.name === "__Host-session");
  const preference = cookies.find(
    (cookie) => cookie.name === "__Host-preference",
  );

  expect(session).toMatchObject({
    httpOnly: true,
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: "alpha",
  });
  expect(preference).toMatchObject({
    httpOnly: false,
    path: "/",
    sameSite: "Strict",
    secure: true,
    value: "beta",
  });
});

test("browser-generated Fetch Metadata reaches route handlers", async ({ page }) => {
  await page.goto("/");
  const metadata = await page.evaluate(async () => {
    const response = await fetch("/api/request-metadata");
    return (await response.json()) as Record<string, string | null>;
  });

  expect(metadata).toMatchObject({
    destination: "empty",
    mode: "cors",
    site: "same-origin",
  });
});

test("issued CSRF tokens complete the browser cookie and header flow", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const issuedResponse = await fetch("/api/csrf");
    const issued = (await issuedResponse.json()) as { token: string };
    const rejected = await fetch("/api/csrf-submit", {
      body: JSON.stringify({ message: "hello" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const accepted = await fetch("/api/csrf-submit", {
      body: JSON.stringify({ message: "hello" }),
      headers: {
        "content-type": "application/json",
        "x-csrf-token": issued.token,
      },
      method: "POST",
    });

    return {
      acceptedBody: await accepted.json(),
      acceptedStatus: accepted.status,
      cookie: document.cookie,
      rejectedStatus: rejected.status,
      token: issued.token,
    };
  });

  expect(result.rejectedStatus).toBe(403);
  expect(result.acceptedStatus).toBe(200);
  expect(result.acceptedBody).toEqual({
    accepted: true,
    body: { message: "hello" },
  });
  expect(result.cookie).toContain(`csrf-token=${result.token}`);
});
