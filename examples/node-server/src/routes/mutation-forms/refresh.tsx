import { json, mutation, mutationInput } from "@demiurgejs/core";
import { incrementMutationVersion } from "../../mutation-state.server";

export const POST = mutation({
  input: mutationInput.formData,
  revalidateRoute: true,
  handler: async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const refreshKey = String(input.get("refreshKey") ?? "example");
    return json({ version: incrementMutationVersion(refreshKey) });
  },
});
