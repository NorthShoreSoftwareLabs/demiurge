import {
  mutation,
  mutationInput,
  redirect,
} from "@demiurgejs/core";
import { z } from "zod";

export const POST = mutation({
  input: mutationInput.form(z.object({
    attachment: z.preprocess(
      (value) => value instanceof File ? value : undefined,
      z.instanceof(File).optional(),
    ),
    title: z.preprocess(
      (value) => typeof value === "string" ? value : "",
      z.string().trim().min(1, "Enter a title."),
    ),
  }), (form) => ({
    attachment: form.get("attachment") || undefined,
    title: form.get("title"),
  })),
  handler: async ({ input }) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const search = new URLSearchParams({
      attachment: input.attachment?.name ?? "none",
      result: "publish",
      title: input.title,
    });
    return redirect(`/mutation-forms?${search}`, 303);
  },
});
