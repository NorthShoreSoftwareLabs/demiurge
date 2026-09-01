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
import { useEffect, useOptimistic, useState } from "react";
import { readMutationVersion } from "../mutation-state.server";

export const GET = page({
  data: async ({ search }) => {
    const refreshKey = search.get("refreshKey") ?? "example";
    if (search.has("refreshKey")) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return {
      refreshKey,
      result: search.get("result"),
      version: readMutationVersion(refreshKey),
    };
  },
  view: MutationFormsPage,
});

export const POST = mutation({
  input: mutationInput.custom<"title", FormData>(async (context) => {
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
  }),
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

function MutationFormsPage({ data }: RouteProps<
  "/mutation-forms",
  { refreshKey: string; result: string | null; version: number }
>) {
  const navigation = useFormNavigation("mutation-form-example");
  const [result, save] = useMutationAction({
    method: "POST",
    route: "/mutation-forms",
  }, undefined);
  const [, publish] = useMutationAction({
    method: "POST",
    route: "/mutation-forms/publish",
  }, undefined);
  const [refreshResult, refresh, refreshPending] = useMutationAction({
    method: "POST",
    route: "/mutation-forms/refresh",
  }, undefined);
  const [optimisticVersion, setOptimisticVersion] = useOptimistic(data.version);
  // A form action runs in the browser only after hydration. A test that
  // submits before this marker appears gets a native submission instead.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return (
    <main>
      <h1>Mutation forms</h1>
      <p data-hydrated={hydrated} data-testid="hydrated-marker">
        {hydrated ? "Hydrated." : "Not hydrated yet."}
      </p>
      <p>Result: {data.result ?? "none"}</p>
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
      <h2>Authoritative route refresh</h2>
      <p>Server version: <output aria-label="Server version">{data.version}</output></p>
      <p>
        Optimistic version:{" "}
        <output aria-label="Optimistic version">{optimisticVersion}</output>
      </p>
      <Form
        action={refresh}
        onSubmit={() => setOptimisticVersion(data.version + 1)}
      >
        <input name="refreshKey" type="hidden" value={data.refreshKey} />
        <button name="outcome" type="submit" value="success">
          Refresh server data
        </button>
        <button name="outcome" type="submit" value="invalid">
          Reject optimistic change
        </button>
        <button name="outcome" type="submit" value="failed">
          Fail optimistic change
        </button>
        <MutationRefreshPending />
      </Form>
      <output aria-label="Mutation refresh pending">
        {refreshPending ? "pending" : "idle"}
      </output>
      <output aria-label="Mutation refresh result">
        {refreshResult?.status ?? "none"}
      </output>
    </main>
  );
}

function MutationPending() {
  const status = useFormStatus();
  return <output aria-label="React form status">{status.pending ? "pending" : "idle"}</output>;
}

function MutationRefreshPending() {
  const status = useFormStatus();
  return <output aria-label="Refresh form status">{status.pending ? "pending" : "idle"}</output>;
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
