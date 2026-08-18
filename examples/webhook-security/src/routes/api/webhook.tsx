import { webhook } from "@demiurgejs/core";

// The secret would come from an environment variable in a real deployment.
// It is a literal here so the integration probe can sign requests with it.
const secret = "demo-webhook-secret";

// webhook.hmac(...) reads the request body as raw bytes before anything else
// touches it, then verifies the signature against those exact bytes. The
// handler below only ever sees `rawBody`, never a parsed or re-encoded body,
// so a signature computed over the original payload still matches here.
export const POST = webhook.hmac({
  handler: ({ rawBody, text }) =>
    Response.json({
      byteLength: rawBody.length,
      received: text(),
    }),
  secret,
});
