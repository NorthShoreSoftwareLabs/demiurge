import { expect, test as base } from "@playwright/test";

type CspViolation = {
  blockedUri: string;
  disposition: string;
  effectiveDirective: string;
  originalPolicy: string;
};

const cspConsolePattern = /content security policy|content-security-policy/i;

export const test = base.extend<{ cspMonitor: void }>({
  cspMonitor: [async ({ page }, use) => {
    const browserViolations: CspViolation[] = [];
    const consoleViolations: string[] = [];

    await page.exposeFunction(
      "__demiurgeRecordCspViolation",
      (violation: CspViolation) => browserViolations.push(violation),
    );
    page.on("console", (message) => {
      if (cspConsolePattern.test(message.text())) {
        consoleViolations.push(message.text());
      }
    });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as Window & {
          __demiurgeRecordCspViolation: (violation: CspViolation) => void;
        }).__demiurgeRecordCspViolation(
          {
            blockedUri: event.blockedURI,
            disposition: event.disposition,
            effectiveDirective: event.effectiveDirective,
            originalPolicy: event.originalPolicy,
          },
        );
      });
    });

    await use();

    expect.soft(consoleViolations, "CSP console violations").toEqual([]);
    expect.soft(browserViolations, "CSP browser events").toEqual([]);
  }, { auto: true }],
});

export { expect } from "@playwright/test";
