import { z } from "zod";

export const feedbackSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  message: z.string().trim().min(10, "Use at least 10 characters."),
});

export type Feedback = z.infer<typeof feedbackSchema>;

export function feedbackFromFormData(input: FormData) {
  return feedbackSchema.safeParse({
    email: input.get("email"),
    message: input.get("message"),
  });
}

let latest: Feedback | undefined;
let submissionCount = 0;

export function saveFeedback(feedback: Feedback) {
  latest = feedback;
  submissionCount += 1;
}

export function readFeedback() {
  return { latest, submissionCount };
}
