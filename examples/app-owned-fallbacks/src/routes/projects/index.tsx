import { Link, page } from "@demiurge/core";

export const GET = page({ view: ProjectsPage });

function ProjectsPage() {
  return (
    <main>
      <p className="eyebrow">Nested route boundary</p>
      <h1>Projects</h1>
      <p>These links exercise the closest project-owned fallback.</p>
      <div className="actions">
        <Link to="/projects/broken">Render failure</Link>
        <a href="/projects/missing">Nested 404</a>
        <a href="/api/broken">API problem</a>
      </div>
    </main>
  );
}
