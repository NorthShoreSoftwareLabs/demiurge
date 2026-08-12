import { page } from "@demiurge-js/core";

export const GET = page(({ path }) => (
  <main>
    <h1>Item: {path.id}</h1>
    <p>This page was rendered by the production Node adapter.</p>
  </main>
));
