import { httpError, mutation, mutationInput, redirect } from "@demiurgejs/core";
import { cacheTags } from "../../cache";
import { writeMessage } from "../../message-store";

export const POST = mutation({
  input: mutationInput.formData,
  revalidate: { tags: [cacheTags.message()] },
  async handler({ input }) {
    const next = input.get("message");

    if (typeof next !== "string" || next.trim() === "") {
      throw httpError(400, "The message field cannot be empty.");
    }

    writeMessage(next.trim());

    return redirect("/", 303);
  },
});
