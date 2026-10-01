import { json, mutation, mutationInput } from "@demiurgejs/core";
import type { StandardSchemaV1 } from "@standard-schema/spec";

const messageSchema: StandardSchemaV1<
  { message: FormDataEntryValue | null },
  { message: string }
> = {
  "~standard": {
    version: 1 as const,
    vendor: "demiurge-scaffold",
    validate(value: unknown) {
      const message = value && typeof value === "object" && "message" in value
        ? value.message
        : undefined;
      if (typeof message !== "string" || !message.trim()) {
        return { issues: [{ message: "Enter a message.", path: ["message"] }] };
      }
      return { value: { message: message.trim() } };
    },
  },
};

export const POST = mutation({
  input: mutationInput.form(messageSchema, (form) => ({
    message: form.get("message"),
  })),
  handler: ({ input }) => json({ message: input.message }),
});
