import {
  mutation,
  mutationInput,
  Form,
  page,
  redirect,
  useFormNavigation,
  type RouteProps,
} from "@demiurgejs/core";

export const GET = page({
  data: ({ search }) => search.get("result"),
  view: MutationFormsPage,
});

export const POST = mutation({
  input: mutationInput.formData,
  handler: ({ input }) => redirect(
    `/mutation-forms?result=${input.get("history") === "replace" ? "replace" : "push"}`,
    input.get("history") === "replace" ? 308 : 303,
  ),
});

function MutationFormsPage({ data }: RouteProps<"/mutation-forms", string | null>) {
  const navigation = useFormNavigation("mutation-form-example");
  return (
    <main>
      <h1>Mutation forms</h1>
      <p>Result: {data ?? "none"}</p>
      <Form action="/mutation-forms" method="post" submissionKey="mutation-form-example">
        <button name="history" type="submit" value="push">Save with push</button>
        <button name="history" type="submit" value="replace">Save with replace</button>
      </Form>
      <output aria-label="Mutation state">{navigation.state}</output>
    </main>
  );
}
