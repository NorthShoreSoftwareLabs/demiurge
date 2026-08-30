import { json } from "@demiurgejs/core";

// Diagnostic endpoint that echoes the X-Forwarded-For header. This simulates
// what a reverse proxy would send and verifies the app correctly reads it.
export const GET = json(({ request }) => {
  const xForwardedFor = request.headers.get("x-forwarded-for");
  const clientIp = xForwardedFor?.split(",")[0]?.trim() ?? "unknown";
  return { clientIp };
}, {
  security: { csrf: false },
});
