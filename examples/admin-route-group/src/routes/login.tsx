import { Link, page, response } from "@demiurgejs/core";
import { authenticate } from "../auth.server";
import { appendSessionCookies, sessions } from "../session.server";

export const GET = page({
  view: () => (
    <main>
      <h1>Log in</h1>
      <p>
        The application authentication function checks the credentials. The
        Demiurge session boundary stores only the returned principal.
      </p>
      <form method="post">
        <label>
          Username
          <input name="username" defaultValue="operator" />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            defaultValue="demiurge-demo"
          />
        </label>
        <button type="submit">Log in</button>
      </form>
      <Link to="/">Return home</Link>
    </main>
  ),
});

export const POST = response(async ({ request, search }) => {
  const form = await request.formData();
  const principal = await authenticate(
    String(form.get("username") ?? ""),
    String(form.get("password") ?? ""),
  );

  if (!principal) {
    return new Response("The credentials are not valid.", {
      headers: { "cache-control": "no-store" },
      status: 401,
    });
  }

  const session = await sessions.open(request);
  await session.create({ principal });
  const requestedTarget = search.get("from");
  const target = requestedTarget?.startsWith("/") &&
      !requestedTarget.startsWith("//")
    ? requestedTarget
    : "/dashboard";
  const result = new Response(null, {
    headers: { location: target },
    status: 303,
  });

  return appendSessionCookies(result, await session.commit());
});
