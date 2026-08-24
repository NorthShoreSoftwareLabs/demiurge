import { httpError, mutation, mutationInput, redirect } from "@demiurgejs/core";
import { cacheTags, invalidation } from "../../cache";
import { writeMessage } from "../../message-store";

export const POST = mutation({
  input: mutationInput.formData,
  async handler({ input }) {
    const next = input.get("message");

    if (typeof next !== "string" || next.trim() === "") {
      throw httpError(400, "The message field cannot be empty.");
    }

    // Commit the mutation before invalidating the tag. Invalidating first
    // would leave a window where a concurrent read repopulates the cache
    // with the value this mutation is about to replace.
    writeMessage(next.trim());
    await invalidation.tags([cacheTags.message()]);

    return redirect("/", 303);
  },
});
