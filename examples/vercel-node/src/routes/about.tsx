import { Link, page } from "@demiurgejs/core";

export const GET = page({ view: About });

function About() {
  return (
    <main>
      <h1>Portable application code</h1>
      <p>The provider integration packages the shared server handler.</p>
      <Link to="/">Return home</Link>
    </main>
  );
}
