import { useEffect, useState } from "react";
import { analytics, defineScripts, page } from "@demiurgejs/core";
import { plausible } from "../analytics";

// The integration owns the script contribution, so the framework attaches the
// request nonce the same way it does for every other managed script.
export const scripts = defineScripts(analytics.scripts(plausible));

function HomePage() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <main>
      <h1 data-testid="page-heading">Analytics under a strict CSP</h1>
      <p data-hydrated={hydrated} data-testid="hydrated-marker">
        {hydrated ? "Hydrated." : "Not hydrated yet."}
      </p>
      <p>
        The analytics script loads from the proxied endpoint and reports a
        pageview through the same origin. No inline snippet is involved, so
        the policy never needs an unsafe-inline source.
      </p>
    </main>
  );
}

export const GET = page({
  view: HomePage,
});
