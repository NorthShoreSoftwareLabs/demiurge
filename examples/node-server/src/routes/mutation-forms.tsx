import {
  mutation,
  mutationInput,
  Form,
  MutationSubmit,
  MutationValidationError,
  page,
  redirect,
  useFormNavigation,
  useMutationAction,
  type RouteProps,
} from "@demiurgejs/core";
import { useFormStatus } from "react-dom";

export const GET = page({
  data: ({ search }) => search.get("result"),
  view: MutationFormsPage,
});

export const POST = mutation({
  input: async (context) => {
    const input = await mutationInput.formData(context);
    if (input.get("mode") === "enhanced" && !input.get("title")) {
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
    if (input.get("mode") === "enhanced") {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return redirect(mutationResultUrl("save", input), 303);
    }
    return redirect(
      `/mutation-forms?result=${input.get("history") === "replace" ? "replace" : "push"}`,
      input.get("history") === "replace" ? 308 : 303,
    );
  },
});

function MutationFormsPage({ data }: RouteProps<"/mutation-forms", string | null>) {
  const navigation = useFormNavigation("mutation-form-example");
  const [result, save] = useMutationAction({
    method: "POST",
    route: "/mutation-forms",
  }, undefined);
  const [, publish] = useMutationAction({
    method: "POST",
    route: "/mutation-forms/publish",
  }, undefined);
  return (
    <main>
      <h1>Mutation forms</h1>
      <p>Result: {data ?? "none"}</p>
      <Form action="/mutation-forms" method="post" submissionKey="mutation-form-example">
        <button name="history" type="submit" value="push">Save with push</button>
        <button name="history" type="submit" value="replace">Save with replace</button>
      </Form>
      <output aria-label="Mutation state">{navigation.state}</output>
      <h2>React mutation form</h2>
      <Form action={save} encType="multipart/form-data">
        <input name="mode" type="hidden" value="enhanced" />
        <label>
          Title
          <input name="title" />
        </label>
        <label>
          Attachment
          <input name="attachment" type="file" />
        </label>
        <button name="intent" type="submit" value="save">
          Save draft
        </button>
        <MutationSubmit formAction={publish} name="intent" type="submit" value="publish">
          Publish draft
        </MutationSubmit>
        <MutationPending />
      </Form>
      <output aria-label="React mutation validation">
        {result?.status === "invalid"
          ? result.validation.issues.map((issue) => issue.message).join(" ")
          : "valid"}
      </output>
    </main>
  );
}

function MutationPending() {
  const status = useFormStatus();
  return <output aria-label="React form status">{status.pending ? "pending" : "idle"}</output>;
}

function mutationResultUrl(intent: string, input: FormData) {
  const attachment = input.get("attachment");
  const search = new URLSearchParams({
    attachment: attachment instanceof File ? attachment.name : "none",
    result: intent,
    title: String(input.get("title") ?? ""),
  });
  return `/mutation-forms?${search}`;
}
