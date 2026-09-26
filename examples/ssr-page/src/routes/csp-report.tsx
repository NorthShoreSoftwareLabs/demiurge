import { page } from "@demiurgejs/core";

const blockedScriptSource = import.meta.env.DEV
  ? "https://blocked.example.test/early.js?private=value#fragment"
  : undefined;

export const GET = page({
  view: CspReportPage,
});

function CspReportPage() {
  return (
    <main className="page-shell">
      <h1>Development CSP report</h1>
      <p>This route tests an early browser report during development.</p>
      {blockedScriptSource
        ? <script src={blockedScriptSource} />
        : null}
    </main>
  );
}
