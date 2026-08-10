import { Link, type RouteErrorProps } from "demiurge";

export default function ProjectError({ pathname, status }: RouteErrorProps) {
  return (
    <main data-fallback-owner="projects-error">
      <p className="status">{status}</p>
      <h1>The project workspace is unavailable</h1>
      <p>Failure path: {pathname}</p>
      <Link to="/projects">Return to projects</Link>
    </main>
  );
}
