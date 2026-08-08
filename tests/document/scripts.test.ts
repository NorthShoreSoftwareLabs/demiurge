import { describe, expect, it } from "vitest";
import {
  defineScripts,
  resolveScripts,
  script,
} from "demiurge";
import type { HttpRouteContext } from "demiurge";

const context = {
  path: {},
  pathname: "/checkout",
  request: new Request("https://example.test/checkout?payment=true"),
  search: new URLSearchParams("payment=true"),
  url: new URL("https://example.test/checkout?payment=true"),
} satisfies HttpRouteContext;

describe("document scripts", () => {
  it("defines static script contributions with a default strategy", async () => {
    const scripts = defineScripts([
      script({
        purpose: "analytics",
        src: "https://analytics.example.com/script.js",
      }),
    ]);

    await expect(resolveScripts([scripts], context)).resolves.toEqual([
      {
        kind: "script",
        purpose: "analytics",
        src: "https://analytics.example.com/script.js",
        strategy: "afterInteractive",
      },
    ]);
  });

  it("resolves request-aware script contributions before document rendering", async () => {
    const scripts = defineScripts(({ search }) => {
      if (search.get("payment") !== "true") {
        return [];
      }

      return [
        script({
          purpose: "payments",
          src: "https://js.stripe.com/v3/",
          strategy: "beforeInteractive",
        }),
      ];
    });

    await expect(resolveScripts([scripts], context)).resolves.toEqual([
      {
        kind: "script",
        purpose: "payments",
        src: "https://js.stripe.com/v3/",
        strategy: "beforeInteractive",
      },
    ]);
  });

  it("dedupes scripts by source, strategy, type, and integrity", async () => {
    const scripts = await resolveScripts(
      [
        [
          script({
            purpose: "analytics",
            src: "https://cdn.example.com/app.js",
          }),
        ],
        [
          script({
            async: true,
            purpose: "analytics",
            src: "https://cdn.example.com/app.js",
          }),
        ],
        [
          script({
            src: "https://cdn.example.com/app.js",
            strategy: "beforeInteractive",
          }),
        ],
      ],
      context,
    );

    expect(scripts).toEqual([
      {
        kind: "script",
        src: "https://cdn.example.com/app.js",
        strategy: "beforeInteractive",
      },
      {
        async: true,
        kind: "script",
        purpose: "analytics",
        src: "https://cdn.example.com/app.js",
        strategy: "afterInteractive",
      },
    ]);
  });
});
