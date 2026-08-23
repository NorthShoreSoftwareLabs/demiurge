import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { page, type RouteProps } from "@demiurgejs/core";
import { feedbackSchema, readFeedback, type Feedback } from "../feedback";

type FormData = ReturnType<typeof readFeedback>;

export const GET = page<string, FormData>({
  data: () => readFeedback(),
  view: FormPage,
});

function FormPage({ data }: RouteProps<"/", FormData>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm({
    defaultValues: { email: "", message: "" } satisfies Feedback,
  });

  async function submitEnhanced(value: Feedback) {
      form.setErrorMap({ onSubmit: undefined });
      const parsed = feedbackSchema.safeParse(value);
      if (!parsed.success) return;

      setIsSubmitting(true);
      const response = await fetch("/api/feedback", {
        body: new URLSearchParams(parsed.data).toString(),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      });

      if (response.status === 422) {
        // TYPE-EVIDENCE: A 422 response from this action always contains field error arrays.
        const payload = await response.json() as {
          errors: Record<string, string[]>;
        };
        form.setErrorMap({
          onSubmit: {
            fields: {},
            form: Object.values(payload.errors).flat().join(" "),
          },
        });
        setIsSubmitting(false);
        return;
      }

      if (response.ok && response.redirected) {
        const target = new URL(response.url);
        if (target.origin !== window.location.origin) {
          throw new Error("The feedback action returned an unsafe redirect.");
        }
        window.location.assign(
          `${target.pathname}${target.search}${target.hash}`,
        );
      }
      setIsSubmitting(false);
  }

  return (
    <main>
      <p className="eyebrow">One action endpoint, two clients</p>
      <h1>Form interoperability</h1>
      <p>
        Disable JavaScript to use the native form. With JavaScript enabled,
        TanStack Form adds pending state and client validation.
      </p>
      <form action="/api/feedback" method="post" onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const parsed = feedbackSchema.safeParse({
          email: values.get("email"),
          message: values.get("message"),
        });
        if (parsed.success) {
          void submitEnhanced(parsed.data);
          return;
        }

        const fieldErrors = parsed.error.flatten().fieldErrors;
        for (const field of ["email", "message"] as const) {
          form.setFieldMeta(field, (meta) => ({
            ...meta,
            errorMap: {
              ...meta.errorMap,
              onSubmit: fieldErrors[field]?.[0],
            },
          }));
        }
      }}>
        <form.Field
          name="email"
          validators={{
            onChange: ({ value }) =>
              feedbackSchema.shape.email.safeParse(value).success
                ? undefined
                : "Enter a valid email address.",
          }}
        >
          {(field) => (
            <label>
              Email
              <input
                name={field.name}
                type="email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  form.setErrorMap({ onSubmit: undefined });
                }}
              />
              {field.state.meta.errors.map((error) => (
                <span className="error" key={error}>{error}</span>
              ))}
            </label>
          )}
        </form.Field>
        <form.Field
          name="message"
          validators={{
            onChange: ({ value }) =>
              feedbackSchema.shape.message.safeParse(value).success
                ? undefined
                : "Use at least 10 characters.",
          }}
        >
          {(field) => (
            <label>
              Message
              <textarea
                name={field.name}
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  form.setErrorMap({ onSubmit: undefined });
                }}
              />
              {field.state.meta.errors.map((error) => (
                <span className="error" key={error}>{error}</span>
              ))}
            </label>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => {
          // TYPE-EVIDENCE: TanStack Form stores every active validation error in this array.
          return state.errors as unknown[];
        }}>
          {(errors) => errors.length > 0 ? (
            <p className="error">{errors.map(String).join(" ")}</p>
          ) : null}
        </form.Subscribe>
        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Saving..." : "Save feedback"}
        </button>
      </form>
      <p aria-live="polite" data-testid="submission-count">
        Saved submissions: {data.submissionCount}
      </p>
      {data.latest ? (
        <p data-testid="latest-feedback">
          Latest message: {data.latest.message}
        </p>
      ) : null}
    </main>
  );
}
