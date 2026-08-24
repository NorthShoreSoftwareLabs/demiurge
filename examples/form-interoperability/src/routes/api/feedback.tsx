import {
  mutation,
  mutationInput,
  json,
  redirect,
} from "@demiurgejs/core";
import { feedbackFromFormData, saveFeedback } from "../../feedback";

export const POST = mutation({
  input: mutationInput.formData,
  async handler({ input }) {
    const parsed = feedbackFromFormData(input);

    if (!parsed.success) {
      return json(
        { errors: parsed.error.flatten().fieldErrors },
        { status: 422 },
      );
    }

    if (parsed.data.message.toLowerCase().includes("blocked")) {
      return json(
        { errors: { message: ["This message is blocked by the server."] } },
        { status: 422 },
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
    saveFeedback(parsed.data);
    return redirect("/?saved=1", 303);
  },
});
