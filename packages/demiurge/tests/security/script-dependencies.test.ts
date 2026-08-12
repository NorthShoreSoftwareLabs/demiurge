import { describe, expect, it } from "vitest";
import {
  auditScriptDependencies,
  createSecurityAudit,
  script,
  security,
} from "@demiurge/core";

describe("script dependency audit", () => {
  it("reports missing purpose and integrity for third-party scripts", () => {
    const findings = auditScriptDependencies(
      [
        script({
          src: "https://cdn.example.com/widget.js",
        }),
      ],
      {
        requireIntegrity: true,
      },
    );

    expect(findings).toEqual([
      {
        code: "script-purpose-missing",
        message:
          "Third-party script https://cdn.example.com/widget.js should declare a purpose for audits and consent flows.",
        severity: "warning",
      },
      {
        code: "script-integrity-missing",
        message:
          "Third-party script https://cdn.example.com/widget.js should declare an integrity hash or an explicit trust-boundary exception.",
        severity: "warning",
      },
    ]);
  });

  it("reports early third-party scripts and GTM wide trust boundaries", () => {
    const findings = auditScriptDependencies([
      script({
        purpose: "analytics",
        src: "https://www.googletagmanager.com/gtm.js?id=GTM-XXXX",
        strategy: "beforeInteractive",
      }),
    ]);

    expect(findings).toEqual([
      {
        code: "script-third-party-before-interactive",
        message:
          "Third-party script https://www.googletagmanager.com/gtm.js?id=GTM-XXXX runs before the app is interactive and should be justified by policy.",
        severity: "warning",
      },
      {
        code: "script-gtm-wide-trust-boundary",
        message:
          "Google Tag Manager can load additional scripts at runtime and should be treated as a wide trust boundary.",
        severity: "warning",
      },
    ]);
  });

  it("ignores same-origin scripts and accepts justified third-party scripts", () => {
    const findings = auditScriptDependencies(
      [
        script({
          src: "/assets/app.js",
        }),
        script({
          integrity: "sha384-demo",
          purpose: "payments",
          src: "https://js.stripe.com/v3/",
        }),
      ],
      {
        requireIntegrity: true,
      },
    );

    expect(findings).toEqual([]);
  });

  it("can include dependency findings in security audit output", () => {
    const audit = createSecurityAudit({
      document: {
        policy: security.static({
          csp: {
            scriptSrc: ["'self'", "https://cdn.example.com"],
          },
        }),
        scriptDependencies: true,
        scripts: [
          script({
            src: "https://cdn.example.com/widget.js",
          }),
        ],
      },
    });

    expect(audit.findings).toEqual([
      {
        code: "script-purpose-missing",
        message:
          "Third-party script https://cdn.example.com/widget.js should declare a purpose for audits and consent flows.",
        severity: "warning",
      },
    ]);
  });
});
