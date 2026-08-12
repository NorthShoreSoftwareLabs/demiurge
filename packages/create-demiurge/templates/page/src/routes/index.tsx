import { page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main className="home">
      <h1>Demiurge</h1>
      <p>Edit src/routes/index.tsx to start your application.</p>
    </main>
  ),
});
