import {
  json,
  mutation,
  mutationInput,
  MutationValidationError,
} from "@demiurgejs/core";
import { incrementMutationVersion } from "../../mutation-state.server";

export const POST = mutation({
  publicData: true,
  input: mutationInput.custom<"outcome", FormData>(async (context) => {
    const input = await mutationInput.formData(context);
    if (input.get("outcome") === "invalid") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      throw new MutationValidationError<"outcome">({
        issues: [{
          code: "rejected",
          message: "The optimistic change was rejected.",
          path: ["outcome"],
        }],
      });
    }
    return input;
  }),
  revalidateRoute: true,
  handler: async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (input.get("outcome") === "failed") {
      return json({ saved: false }, { status: 409 });
    }
    const refreshKey = String(input.get("refreshKey") ?? "example");
    return json({ version: incrementMutationVersion(refreshKey) });
  },
});
