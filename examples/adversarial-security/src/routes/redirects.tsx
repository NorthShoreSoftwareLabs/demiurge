import { Form, page, useMutationAction } from "@demiurgejs/core";

export const GET = page({
  view: RedirectChecks,
});

function RedirectChecks() {
  const [, submitSafe] = useMutationAction({
    method: "POST",
    route: "/api/redirect-safe",
  }, undefined);
  const [unsafeResult, submitUnsafe] = useMutationAction({
    method: "POST",
    route: "/api/redirect-unsafe",
  }, undefined);

  return (
    <main>
      <h1>Mutation redirect checks</h1>
      <p data-testid="safe-result">
        A safe redirect stays on this origin.
      </p>
      <Form action={submitSafe}>
        <button data-testid="safe-redirect" type="submit">Use safe redirect</button>
      </Form>
      <Form action={submitUnsafe}>
        <button data-testid="unsafe-redirect" type="submit">
          Attempt unsafe redirect
        </button>
      </Form>
      <output data-testid="unsafe-result">
        {unsafeResult?.status === "failed"
          ? unsafeResult.message ?? "The mutation failed."
          : unsafeResult?.status ?? "idle"}
      </output>
    </main>
  );
}
