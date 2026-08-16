import { json, text } from "@demiurgejs/core";

export const GET = json<{ ok: boolean; pathname: string; requestId: string }, "/api/health">(({ pathname, context }) => ({
  ok: true,
  pathname,
  requestId: context.requestId,
}), {
  cors: {
    origins: "*",
  },
});

export const POST = text(({ request }) => request.text(), {
  security: {
    // A Cookie header activates Demiurge's default double-submit CSRF check.
    rateLimit: {
      key: "ip",
      limit: 60,
      window: "1m",
    },
    request: {
      allowedMethods: ["POST"],
      maxBodySize: "1kb",
    },
  },
});
