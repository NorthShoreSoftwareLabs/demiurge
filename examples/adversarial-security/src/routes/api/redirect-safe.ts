import { mutation, redirect } from "@demiurgejs/core";

export const POST = mutation({
  handler: () => redirect("/redirects?safe=1", 303),
});
