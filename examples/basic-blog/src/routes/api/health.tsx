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
    request: {
      allowedMethods: ["POST"],
      maxBodySize: "1kb",
    },
  },
});
