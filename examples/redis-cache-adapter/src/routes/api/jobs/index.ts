import { json, mutation, mutationInput } from "@demiurgejs/core";
import { enqueueJob } from "../../../redis.server";

export const POST = mutation({
  input: mutationInput.json,
  async handler({ input }) {
    return json(await enqueueJob(input));
  },
});
