import { Link, page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Admin route group</h1>
      <p>
        The <code>(admin)</code> route group wraps <code>/dashboard</code> and{" "}
        <code>/settings</code> in one shared layout and one shared session
        policy, without adding an <code>/admin</code> URL segment.
      </p>
      <p>
        Visit <Link to="/dashboard">Dashboard</Link> or{" "}
        <Link to="/settings">Settings</Link> without a session cookie and the
        group middleware redirects both to <Link to="/login">Log in</Link>.
      </p>
    </main>
  ),
});
