import type { NotFoundProps } from "demiurge";

export default function NotFound({ pathname }: NotFoundProps) {
  return <main>Nothing is available at {pathname}.</main>;
}
