import type { NotFoundProps, RouteErrorProps } from "../route";

// This fallback is deliberately plain. It prevents a blank 404 response. The
// build gate prevents an application from using it in production. The framework
// must not show a generic page to users.
export function BuiltInNotFound({ pathname }: NotFoundProps) {
  return (
    <main>
      <h1>404</h1>
      <p>No route matched {pathname}.</p>
    </main>
  );
}

export function BuiltInError({ status }: RouteErrorProps) {
  return (
    <main>
      <h1>{status}</h1>
      <p>Something went wrong.</p>
    </main>
  );
}

// Dev only. Everything this renders is a file path or a stack frame, which is
// exactly what must never reach a production body.
export function DevError({ error, pathname, status }: RouteErrorProps) {
  const { message, name, stack } = describeError(error);

  return (
    <main>
      <h1>
        {status} {name} at {pathname}
      </h1>
      <p>{message}</p>
      {stack ? <pre>{stack}</pre> : null}
    </main>
  );
}

export function describeError(error: unknown) {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === "string" ? error : String(error),
    name: "Error",
    stack: undefined,
  };
}
