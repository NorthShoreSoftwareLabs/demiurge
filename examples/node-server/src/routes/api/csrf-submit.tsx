import { json } from "@demiurge/core";

export const POST = json(
  async ({ request }) => ({
    accepted: true,
    body: await request.json(),
  }),
  {
    security: {
      request: { maxBodySize: "8kb" },
    },
  },
);
