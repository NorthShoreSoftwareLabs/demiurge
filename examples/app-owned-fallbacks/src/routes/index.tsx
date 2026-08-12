import { Link, page } from "@demiurge/core";

export const GET = page({ view: HomePage });

function HomePage() {
  return (
    <main>
      <p className="eyebrow">App-owned failure states</p>
      <h1>Fallbacks follow route ownership</h1>
      <p>
        Root paths and project paths resolve different loading, not-found, and
        error components.
      </p>
      <div className="actions">
        <Link to="/projects">Open projects</Link>
        <a href="/missing">Root 404</a>
      </div>
    </main>
  );
}
