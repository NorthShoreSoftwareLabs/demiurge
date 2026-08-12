import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const exampleRoot = resolve("examples/runtime-server-data");
await assertClientExcludesServerData(exampleRoot);
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
  const firstDocument = await fetchDocument(origin);
  assertDocumentIncludes(firstDocument, 'data-channel="private:guest"');
  const first = parseCounts(firstDocument);
  const second = parseCounts(await fetchDocument(origin));

  assertCounts(first, {
    none: [1, 2],
    private: [1],
    public: [1],
    request: [1, 1],
  });
  assertCounts(second, {
    none: [3, 4],
    private: [1],
    public: [1],
    request: [2, 2],
  });

  const otherAccountDocument = await fetchDocument(origin, {
    "x-demo-account": "ada",
  });
  assertDocumentIncludes(otherAccountDocument, 'data-channel="private:ada"');
  const otherAccount = parseCounts(otherAccountDocument);
  assertCounts(otherAccount, {
    none: [5, 6],
    private: [1],
    public: [1],
    request: [3, 3],
  });

  await new Promise((resolveWait) => setTimeout(resolveWait, 2_100));

  const afterTtl = parseCounts(await fetchDocument(origin));
  assertCounts(afterTtl, {
    none: [7, 8],
    private: [1],
    public: [2],
    request: [4, 4],
  });

  console.log("runtime server data probe passed");
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

async function assertClientExcludesServerData(root: string) {
  const assetsDir = resolve(root, "dist/client/assets");
  const files = await readdir(assetsDir);
  const javascript = await Promise.all(
    files
      .filter((file) => file.endsWith(".js"))
      .map((file) => readFile(resolve(assetsDir, file), "utf8")),
  );
  const bundle = javascript.join("\n");
  const forbidden = [
    "x-demo-account",
    "runtime-source",
    "Runtime data source returned",
  ];
  const leaked = forbidden.find((value) => bundle.includes(value));

  if (leaked) {
    throw new Error(
      `Client build leaked server page-data code containing ${JSON.stringify(leaked)}.`,
    );
  }
}

async function fetchDocument(origin: string, headers: Record<string, string> = {}) {
  const response = await fetch(origin, {
    headers: { accept: "text/html", ...headers },
  });

  if (!response.ok) {
    throw new Error(
      `Runtime data example returned ${response.status}: ${await response.text()}`,
    );
  }

  return await response.text();
}

function parseCounts(html: string) {
  return Object.fromEntries(
    ["public", "private", "request", "none"].map((scope) => {
      const element = new RegExp(
        `<dd[^>]*data-count="(\\d+)"[^>]*data-testid="${scope}"[^>]*>([\\s\\S]*?)</dd>`,
      ).exec(html);

      if (!element) {
        throw new Error(`Runtime data response omitted the ${scope} result.`);
      }

      const secondary = /data-secondary-count="(\d+)"/.exec(element[2]);
      return [
        scope,
        [Number(element[1]), ...(secondary ? [Number(secondary[1])] : [])],
      ];
    }),
  );
}

function assertCounts(
  actual: Record<string, number[]>,
  expected: Record<string, number[]>,
) {
  const matches = Object.entries(expected).every(
    ([scope, counts]) =>
      actual[scope]?.length === counts.length &&
      counts.every((count, index) => actual[scope]?.[index] === count),
  );

  if (!matches || Object.keys(actual).length !== Object.keys(expected).length) {
    throw new Error(
      `Unexpected runtime cache counters. Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`,
    );
  }
}

function assertDocumentIncludes(document: string, expected: string) {
  if (!document.includes(expected)) {
    throw new Error(`Runtime data response omitted ${expected}.`);
  }
}

function waitForOrigin(process: ReturnType<typeof spawn>) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error(`Runtime data server did not start in time. ${stderr}`),
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
          `Runtime data server exited with code ${code}. ${stderr}`,
        ),
      );
    });
  });
}
