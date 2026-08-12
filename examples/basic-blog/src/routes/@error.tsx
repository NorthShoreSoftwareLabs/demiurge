import type { RouteErrorProps } from "@demiurgejs/core";

export default function RouteError({ error, pathname }: RouteErrorProps) {
  const message = error instanceof Error ? error.message : "Unknown route error";

  return (
    <article>
      <p className="eyebrow">Route error</p>
      <h1>Something went wrong at {pathname}</h1>
      <p>{message}</p>
    </article>
  );
}
