import { Link, page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Bring your own authentication</h1>
      <p>
        The application checks credentials and permissions. Demiurge manages
        the session lifecycle and the typed middleware context.
      </p>
      <p>
        Visit <Link to="/dashboard">Dashboard</Link> or{" "}
        <Link to="/settings">Settings</Link>. The group middleware redirects
        unauthenticated requests to <Link to="/login">Log in</Link>.
      </p>
    </main>
  ),
});
