import {
  mutation,
  mutationInput,
  MutationValidationError,
  redirect,
} from "@demiurgejs/core";

export const POST = mutation({
  input: async (context) => {
    const input = await mutationInput.formData(context);
    if (!input.get("title")) {
      throw new MutationValidationError<"title">({
        issues: [{
          code: "required",
          message: "Enter a title.",
          path: ["title"],
        }],
      });
    }
    return input;
  },
  validation: { fields: ["title"] },
  handler: async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const attachment = input.get("attachment");
    const search = new URLSearchParams({
      attachment: attachment instanceof File ? attachment.name : "none",
      result: "publish",
      title: String(input.get("title") ?? ""),
    });
    return redirect(`/mutation-forms?${search}`, 303);
  },
});
