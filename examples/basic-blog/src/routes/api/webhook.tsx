import { webhook } from "@demiurge/core";

export const POST = webhook.hmac({
  handler: ({ rawBody }) => Response.json({ received: rawBody.length }),
  secret: "demo-secret",
});
