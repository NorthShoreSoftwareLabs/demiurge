import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { resolve } from "node:path";

// This probe runs a real `redis-server` and a real built example against it,
// the same way `packages/core/tests/redis/store.test.ts` does. A mock Redis
// cannot prove the example's page route and its `/api/invalidate` route
// coordinate through the same Redis database. `hasRedisServer` gates the
// probe instead of failing on a machine without the binary on PATH.
const hasRedisServer = spawnSync("redis-server", ["--version"]).status === 0;

if (!hasRedisServer) {
  console.log(
    "redis-server is not on PATH; skipping the redis cache adapter probe.",
  );
  process.exit(0);
}

const exampleRoot = resolve("examples/redis-cache-adapter");
const redisPort = 23_000 + (process.pid % 10_000);
let redis: ChildProcessWithoutNullStreams | undefined;
let server: ChildProcessWithoutNullStreams | undefined;

try {
  redis = await startRedis(redisPort);
  server = spawn(process.execPath, ["server.js"], {
    cwd: exampleRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      PORT: "0",
      REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    },
  });

  let stderr = "";
  server.stderr.setEncoding("utf8");
  server.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const origin = await waitForOrigin(server, () => stderr);

  const first = await fetchLoadCount(origin, "1");
  const second = await fetchLoadCount(origin, "1");

  if (second !== first) {
    throw new Error(
      `Expected the second request to be a cache hit with load count ${first}, received ${second}.`,
    );
  }

  await invalidateTag(origin, "posts");

  const third = await fetchLoadCount(origin, "1");

  if (third <= second) {
    throw new Error(
      `Expected invalidation to bust the cache and raise the load count past ${second}, received ${third}.`,
    );
  }

  console.log(
    `redis cache adapter probe passed (miss=${first}, hit=${second}, post-invalidation miss=${third})`,
  );
} finally {
  await stop(server);
  await stop(redis);
}

async function startRedis(port: number) {
  const child = spawn("redis-server", [
    "--port",
    String(port),
    "--bind",
    "127.0.0.1",
    "--save",
    "",
    "--appendonly",
    "no",
    "--daemonize",
    "no",
  ]);

  await new Promise<void>((resolvePromise, reject) => {
    let output = "";
    // Matches the 10s bound on the sibling wait in `waitForOrigin` below.
    const timeout = setTimeout(() => {
      reject(new Error(`redis-server did not report ready in time. ${output}`));
    }, 10_000);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes("Ready to accept connections")) {
        child.stdout.off("data", onData);
        clearTimeout(timeout);
        resolvePromise();
      }
    };
    child.stdout.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`redis-server exited early with code ${code}.`));
    });
  });

  return child;
}

async function fetchLoadCount(origin: string, id: string) {
  const response = await fetch(`${origin}/posts/${id}`, {
    headers: { accept: "text/html" },
  });

  if (!response.ok) {
    throw new Error(
      `Redis cache adapter post request returned ${response.status}: ${await response.text()}`,
    );
  }

  const html = await response.text();
  const match = /data-load-count="(\d+)"/.exec(html);

  if (!match) {
    throw new Error("Redis cache adapter response omitted the load count.");
  }

  return Number(match[1]);
}

async function invalidateTag(origin: string, tagId: string) {
  const response = await fetch(`${origin}/api/invalidate`, {
    body: JSON.stringify({ tag: tagId }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(
      `Redis cache adapter invalidation returned ${response.status}: ${await response.text()}`,
    );
  }

  return await response.json() as { deleted: number; kind: string };
}

function waitForOrigin(
  child: ChildProcessWithoutNullStreams,
  readStderr: () => string,
) {
  return new Promise<string>((resolveOrigin, rejectOrigin) => {
    const timeout = setTimeout(() => {
      rejectOrigin(
        new Error(
          `Redis cache adapter server did not start in time. ${readStderr()}`,
        ),
      );
    }, 10_000);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const match = /listening on (http:\/\/[^\s]+)/.exec(chunk);

      if (match) {
        clearTimeout(timeout);
        resolveOrigin(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOrigin(
        new Error(
          `Redis cache adapter server exited with code ${code}. ${readStderr()}`,
        ),
      );
    });
  });
}

async function stop(child: ChildProcessWithoutNullStreams | undefined) {
  if (!child) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolveExit) => {
    if (child.exitCode !== null) {
      resolveExit();
      return;
    }

    child.once("exit", () => resolveExit());
  });
}
