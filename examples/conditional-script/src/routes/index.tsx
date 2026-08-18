import { Link, page } from "@demiurgejs/core";

function HomePage() {
  return (
    <main>
      <h1>Conditional script example</h1>
      <p>
        This route never loads the vendor analytics script. The{" "}
        <Link to="/dashboard">dashboard route</Link> loads it, and only after
        a visitor grants consent.
      </p>
    </main>
  );
}

export const GET = page({
  view: HomePage,
});
