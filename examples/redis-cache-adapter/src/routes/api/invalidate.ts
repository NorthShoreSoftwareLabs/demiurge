import { json, mutation, mutationInput } from "@demiurgejs/core";
import { invalidatePostTag } from "../../redis.server";

export const POST = mutation({
  input: mutationInput.json,
  async handler({ input }) {
    const tagId = input && typeof input === "object" && "tag" in input
      ? String(input.tag ?? "")
      : "";
    return json(await invalidatePostTag(tagId));
  },
});
