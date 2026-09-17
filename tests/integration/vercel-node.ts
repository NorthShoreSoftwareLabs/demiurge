import { createServer } from "node:http";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

process.env.ALLOWED_HOSTS = "127.0.0.1";

const functionEntry = resolve(
  "examples/vercel-node/.vercel/output/functions/demiurge.func/index.mjs",
);
const staticDirectory = resolve("examples/vercel-node/.vercel/output/static");
const module = await import(pathToFileURL(functionEntry).href);

if (typeof module.default !== "function") {
  throw new Error("The Vercel function entry does not export a listener.");
}

const server = createServer((request, response) => {
  void module.default(request, response);
});

await new Promise<void>((resolveListen) => {
  server.listen(0, "127.0.0.1", resolveListen);
});

try {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("The Vercel function probe has no loopback address.");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin, { headers: { accept: "text/html" } });
  const html = await page.text();

  if (
    page.status !== 200 ||
    page.headers.get("cache-control") !== "private, no-store" ||
    !page.headers.get("content-security-policy") ||
    !html.includes("Demiurge runs on Vercel")
  ) {
    throw new Error("The generated Vercel function did not return its secure page response.");
  }

  const asset = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
  if (!asset) {
    throw new Error("The generated Vercel page does not reference a client asset.");
  }
  await access(resolve(staticDirectory, `.${asset}`));

  const contact = await fetch(`${origin}/api/contact`, {
    body: JSON.stringify({
      email: "test@example.test",
      message: "This request does not send an email.",
      name: "Test User",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (contact.status !== 502) {
    throw new Error(`The contact endpoint returned ${contact.status} without email credentials.`);
  }

  console.log("Vercel Node function artifact probe passed.");
} finally {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}
