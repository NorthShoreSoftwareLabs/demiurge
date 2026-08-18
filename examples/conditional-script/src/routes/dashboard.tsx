import { useEffect, useState } from "react";
import { defineScripts, page, script, type RouteProps } from "@demiurgejs/core";

// The dashboard is the only route that ever contributes the analytics
// script. Even here, it does so only once a visitor grants consent through
// the `consent` query parameter. Every other route, and this route without
// consent, never emits the script tag at all.
export const scripts = defineScripts(({ search }) => {
  if (search.get("consent") !== "granted") {
    return [];
  }

  return [
    script({
      async: true,
      id: "conditional-analytics",
      purpose: "analytics",
      src: "/vendor/analytics",
      strategy: "afterInteractive",
    }),
  ];
});

function DashboardPage({
  data,
}: RouteProps<"/dashboard", { consentGranted: boolean }>) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  return (
    <main>
      <h1 data-testid="dashboard-heading">Dashboard</h1>
      <p data-hydrated={hydrated} data-testid="hydrated-marker">
        {hydrated ? "Hydrated." : "Not hydrated yet."}
      </p>
      <p data-consent={data.consentGranted} data-testid="consent-status">
        Consent {data.consentGranted ? "granted" : "not granted"}.
      </p>
    </main>
  );
}

export const GET = page({
  data: ({ search }) => ({
    consentGranted: search.get("consent") === "granted",
  }),
  view: DashboardPage,
});
