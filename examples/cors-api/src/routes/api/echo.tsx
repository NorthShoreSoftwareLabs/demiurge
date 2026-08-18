import { response } from "@demiurgejs/core";

// The example client page runs on this origin. Naming it explicitly, rather
// than a wildcard, is what makes `credentials: true` legal below.
const CLIENT_ORIGIN = "http://localhost:42183";

// A JSON body and a custom `x-demo-token` header make this a non-simple
// request, so the browser sends a preflight before the POST. The policy
// lists both headers explicitly and exposes the response token header. A
// credentialed policy cannot use a `*` for either list.
export const POST = response(async ({ request }) => {
  const body = await request.json();
  const token = request.headers.get("x-demo-token") ?? "none";

  return new Response(
    JSON.stringify({ echoed: body, receivedToken: token }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "x-demo-response-token": token,
      },
    },
  );
}, {
  cors: {
    credentials: true,
    exposeHeaders: ["x-demo-response-token"],
    headers: ["content-type", "x-demo-token"],
    methods: ["POST"],
    origins: [CLIENT_ORIGIN],
  },
});
