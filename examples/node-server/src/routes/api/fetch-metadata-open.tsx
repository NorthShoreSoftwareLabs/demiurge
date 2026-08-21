import { json } from "@demiurgejs/core";

// This route intentionally serves another site through CORS. The exemption
// makes that intent explicit, so the same route group can still guard every
// other route.
export const GET = json(
  ({ request }) => ({
    open: true,
    site: request.headers.get("sec-fetch-site"),
  }),
  {
    cors: {
      origins: "*",
    },
    security: {
      fetchMetadata: { allowCrossSite: true },
    },
  },
);
