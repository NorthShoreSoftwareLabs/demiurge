import type { RouteErrorProps } from "@demiurgejs/core";

export default function ErrorPage({ pathname, status }: RouteErrorProps) {
  return <main>Error {status} while loading {pathname}.</main>;
}
