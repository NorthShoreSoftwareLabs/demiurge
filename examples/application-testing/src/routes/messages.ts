import { json, mutation, mutationInput } from "@demiurgejs/core";

export const POST = mutation({
  input: mutationInput.formData,
  handler: ({ input }) => json({ message: input.get("message") }),
});
