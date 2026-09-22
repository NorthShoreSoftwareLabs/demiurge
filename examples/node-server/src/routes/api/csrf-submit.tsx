import { json } from "@demiurgejs/core";

export const POST = json(
  async ({ request }) => ({
    accepted: true,
    body: await request.json(),
  }),
  {
    security: {
      csrf: true,
      request: { maxBodySize: "8kb" },
    },
  },
);
