import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Webhook security</h1>
      <p>
        <code>POST /api/webhook</code> verifies an HMAC signature against the
        exact bytes of the request body. A correctly signed request succeeds.
        A missing or incorrect signature is rejected before the handler runs.
      </p>
    </main>
  ),
});
