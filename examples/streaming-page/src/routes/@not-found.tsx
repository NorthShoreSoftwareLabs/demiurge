import type { NotFoundProps } from "@demiurgejs/core";

export default function NotFound({ pathname }: NotFoundProps) {
  return <main>Nothing is available at {pathname}.</main>;
}
