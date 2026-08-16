import { Link, page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <p>Root policy</p>
      <h1>Shared security defaults</h1>
      <p>The root policy permits the example API origin.</p>
      <Link to="/admin">Open the tightened admin policy</Link>
    </main>
  ),
});
