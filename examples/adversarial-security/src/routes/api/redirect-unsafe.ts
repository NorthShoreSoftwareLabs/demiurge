import { mutation, redirect } from "@demiurgejs/core";

export const POST = mutation({
  handler: () => redirect(new URL("https://attacker.example/collect"), 303),
});
