import { Link, type NotFoundProps } from "@demiurgejs/core";

export default function ProjectNotFound({ pathname }: NotFoundProps) {
  return (
    <main data-fallback-owner="projects-not-found">
      <p className="status">404</p>
      <h1>No project page at {pathname}</h1>
      <p>This nearest fallback still renders inside both inherited layouts.</p>
      <Link to="/projects">Return to projects</Link>
    </main>
  );
}
