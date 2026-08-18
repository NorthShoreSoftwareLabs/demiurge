import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Settings</h1>
      <p>The same session policy protects this route, and its sibling.</p>
    </main>
  ),
});
