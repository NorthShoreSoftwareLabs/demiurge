import { json, text } from "demiurge";

export const GET = json(({ pathname }) => ({
  ok: true,
  pathname,
}), {
  cors: {
    origins: "*",
  },
});

export const POST = text(({ request }) => request.text(), {
  security: {
    csrf: true,
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
