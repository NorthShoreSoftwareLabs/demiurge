import { json } from "@demiurgejs/core";

// A plain GET with no custom headers is a simple request, so the browser
// sends it directly without a preflight. Any origin may read the response.
export const GET = json({ message: "hello from a different origin" }, {
  cors: {
    origins: "*",
  },
});
