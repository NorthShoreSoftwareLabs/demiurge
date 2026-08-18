import { page } from "@demiurgejs/core";

function HomePage() {
  return (
    <main>
      <h1>Demiurge CORS API</h1>
      <p>
        This origin serves a Demiurge API with a declared CORS policy. A
        separate origin at <code>client-server.js</code> loads a plain HTML
        page and calls <code>/api/greeting</code> and <code>/api/echo</code>
        {" "}from there.
      </p>
      <p>
        <code>/api/greeting</code> allows any origin and answers a simple GET
        request with no preflight. <code>/api/echo</code> only allows the
        example client origin, allows credentials, and answers a POST with a
        JSON body, so the browser sends a preflight OPTIONS request first.
      </p>
    </main>
  );
}

export const GET = page({
  view: HomePage,
});
