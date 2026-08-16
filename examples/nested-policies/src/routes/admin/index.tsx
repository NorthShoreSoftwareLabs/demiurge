import { Link, page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <p>Nested policy</p>
      <h1>Tightened admin policy</h1>
      <p>The admin policy replaces the root API origin and referrer policy.</p>
      <Link to="/">Return home</Link>
    </main>
  ),
});
