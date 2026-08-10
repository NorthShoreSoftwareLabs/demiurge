import type { NotFoundProps } from "../route";

// Deliberately plain. The framework ships a working 404 so nothing is ever
// blank, and the build gate refuses to let an app reach production still
// rendering this one. A generic framework page in front of real users is a
// failure of the framework, not of the app that never got around to it.
export function BuiltInNotFound({ pathname }: NotFoundProps) {
  return (
    <main>
      <h1>404</h1>
      <p>No route matched {pathname}.</p>
    </main>
  );
}
