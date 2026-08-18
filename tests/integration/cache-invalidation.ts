import { spawn } from "node:child_process";
import { resolve } from "node:path";

const exampleRoot = resolve("examples/cache-invalidation");
const child = spawn(process.execPath, ["server.js"], {
  cwd: exampleRoot,
  env: {
    ...process.env,
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    PORT: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

try {
  const origin = await waitForOrigin(child);

  // A fresh read reaches the source once and caches the result.
  const first = parseMessage(await fetchDocument(origin));
  assertMessage(first, { message: "Welcome to Demiurge.", sourceReads: 1 });

  // A second read reuses the cached entry. The source read counter does not
  // move, proving the page is not silently bypassing the cache.
  const second = parseMessage(await fetchDocument(origin));
  assertMessage(second, { message: "Welcome to Demiurge.", sourceReads: 1 });

  // The action commits the mutation and invalidates the "message" tag.
  const updateResponse = await postMessage(origin, "Cache invalidation works.");
  if (updateResponse.status !== 303 || updateResponse.headers.get("location") !== "/") {
    throw new Error(
      `Update action returned status ${updateResponse.status} with location ${updateResponse.headers.get("location")}.`,
    );
  }

  // The next read reaches the source again because the tag was invalidated,
  // and it observes the new value rather than the stale cached one.
  const third = parseMessage(await fetchDocument(origin));
  assertMessage(third, {
    message: "Cache invalidation works.",
    sourceReads: 2,
  });

  // A further read reuses the newly cached entry.
  const fourth = parseMessage(await fetchDocument(origin));
  assertMessage(fourth, {
    message: "Cache invalidation works.",
    sourceReads: 2,
  });

  console.log("cache invalidation probe passed");
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit();
      return;
    }

    child.once("exit", () => resolveExit());
  });
}

async function fetchDocument(origin: string) {
  const response = await fetch(origin, {
    headers: { accept: "text/html" },
  });

  if (!response.ok) {
    throw new Error(
      `Cache invalidation example returned ${response.status}: ${await response.text()}`,
    );
  }

  return await response.text();
}

async function postMessage(origin: string, message: string) {
  return await fetch(`${origin}/api/message`, {
    body: new URLSearchParams({ message }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    method: "POST",
    redirect: "manual",
  });
}

function parseMessage(html: string) {
  const messageMatch = /data-testid="message">([^<]*)</.exec(html);
  const sourceReadsMatch =
    /data-testid="source-reads">(\d+)</.exec(html);

  if (!messageMatch || !sourceReadsMatch) {
    throw new Error("Cache invalidation response omitted the message result.");
  }

  return {
    message: messageMatch[1],
    sourceReads: Number(sourceReadsMatch[1]),
  };
}

function assertMessage(
  actual: { message: string; sourceReads: number },
  expected: { message: string; sourceReads: number },
) {
  if (
    actual.message !== expected.message ||
    actual.sourceReads !== expected.sourceReads
  ) {
    throw new Error(
      `Unexpected cache invalidation state. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error(`Cache invalidation server did not start in time. ${stderr}`),
      );
    }, 10_000);

    process.stdout?.setEncoding("utf8");
    process.stdout?.on("data", (chunk: string) => {
      const match = /listening on (http:\/\/[^\s]+)/.exec(chunk);

      if (match) {
        clearTimeout(timeout);
        resolveOrigin(match[1]);
      }
    });
    process.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOrigin(
        new Error(
          `Cache invalidation server exited with code ${code}. ${stderr}`,
        ),
      );
    });
  });
}
