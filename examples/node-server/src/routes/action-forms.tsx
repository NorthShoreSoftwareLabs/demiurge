import {
  action,
  actionInput,
  Form,
  page,
  redirect,
  useFormNavigation,
  type RouteProps,
} from "@demiurgejs/core";

export const GET = page({
  data: ({ search }) => search.get("result"),
  view: ActionFormsPage,
});

export const POST = action({
  input: actionInput.formData,
  handler: ({ input }) => redirect(
    `/action-forms?result=${input.get("history") === "replace" ? "replace" : "push"}`,
    input.get("history") === "replace" ? 308 : 303,
  ),
});

function ActionFormsPage({ data }: RouteProps<"/action-forms", string | null>) {
  const navigation = useFormNavigation("action-form-example");
  return (
    <main>
      <h1>Action forms</h1>
      <p>Result: {data ?? "none"}</p>
      <Form action="/action-forms" method="post" submissionKey="action-form-example">
        <button name="history" type="submit" value="push">Save with push</button>
        <button name="history" type="submit" value="replace">Save with replace</button>
      </Form>
      <output aria-label="Action state">{navigation.state}</output>
    </main>
  );
}
