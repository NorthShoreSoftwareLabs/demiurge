import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Dashboard</h1>
      <p>The session policy on the admin group let this request through.</p>
    </main>
  ),
});
