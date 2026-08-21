import { json } from "@demiurgejs/core";

// The Fetch Metadata policy is opt-in. This route allows a same-origin
// request and a top-level navigation, and it denies every other cross-site
// use. It does not trust `same-site`, because a sibling subdomain can belong
// to another team.
export const GET = json(
  ({ request }) => ({
    guarded: true,
    site: request.headers.get("sec-fetch-site"),
  }),
  {
    security: {
      fetchMetadata: true,
    },
  },
);
