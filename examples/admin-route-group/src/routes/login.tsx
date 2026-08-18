import { Link, page, response } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Log in</h1>
      <p>
        The <code>(admin)</code> group middleware sent you here because no
        session cookie was present. Submit the form to set a demo session
        cookie and return to the page you asked for.
      </p>
      <form method="post">
        <button type="submit">Log in</button>
      </form>
      <Link to="/">Return home</Link>
    </main>
  ),
});

// A real application would verify credentials here. This demo only shows
// that the group session policy actually gates every route under it.
export const POST = response(({ search }) => {
  const target = search.get("from") ?? "/dashboard";

  return new Response(null, {
    headers: {
      location: target,
      "set-cookie": "session=1; Path=/",
    },
    status: 303,
  });
});
