import { json } from "@demiurgejs/core";
import { countAcceptedBody } from "../../effects";

export const POST = json(
  async ({ request }) => {
    const body = await request.text();
    return { acceptedBodies: countAcceptedBody(), bytes: body.length };
  },
  { security: { request: { maxBodySize: "32b" } } },
);
