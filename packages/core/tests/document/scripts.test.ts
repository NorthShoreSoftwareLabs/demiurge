import { describe, expect, it } from "vitest";
import {
  defineScripts,
  resolveScripts,
  script,
} from "@demiurge-js/core";
import type { HttpRouteContext } from "@demiurge-js/core";

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

  it("orders the supported strategies beforeInteractive, module, then afterInteractive", async () => {
    const scripts = await resolveScripts(
      [
        [
          script({
            src: "https://cdn.example.com/after.js",
            strategy: "afterInteractive",
          }),
          script({ src: "https://cdn.example.com/module.js", strategy: "module" }),
          script({
            src: "https://cdn.example.com/before.js",
            strategy: "beforeInteractive",
          }),
        ],
      ],
      context,
    );

    expect(scripts.map((scriptTag) => scriptTag.src)).toEqual([
      "https://cdn.example.com/before.js",
      "https://cdn.example.com/module.js",
      "https://cdn.example.com/after.js",
    ]);
  });

  it("rejects strategies whose client loading runtime is not implemented", () => {
    expect(() =>
      script({
        src: "https://cdn.example.com/idle.js",
        strategy: "idle" as never,
      }),
    ).toThrow(/Unsupported script strategy "idle"/);
  });

  it("rejects a module strategy that is overridden with a classic script type", () => {
    expect(() =>
      script({
        src: "https://cdn.example.com/app.js",
        strategy: "module",
        type: "text/javascript",
      }),
    ).toThrow(/cannot be combined/);
  });

  it("treats scripts with the same src but a different type as distinct entries", async () => {
    const scripts = await resolveScripts(
      [
        [
          script({ src: "https://cdn.example.com/app.js" }),
          script({ src: "https://cdn.example.com/app.js", type: "module" }),
        ],
      ],
      context,
    );

    expect(scripts).toHaveLength(2);
  });

  it("skips false and undefined contribution entries", async () => {
    const scripts = await resolveScripts(
      [
        false,
        undefined,
        [script({ src: "https://cdn.example.com/app.js" })],
      ],
      context,
    );

    expect(scripts).toEqual([
      {
        kind: "script",
        src: "https://cdn.example.com/app.js",
        strategy: "afterInteractive",
      },
    ]);
  });

  it("resolves to an empty list when a contribution function returns no scripts", async () => {
    const scripts = defineScripts(({ search }) => {
      if (search.get("nonexistent") === "true") {
        return [script({ src: "https://cdn.example.com/never.js" })];
      }

      return [];
    });

    await expect(resolveScripts([scripts], context)).resolves.toEqual([]);
  });

  it("propagates a rejection when a contribution function throws", async () => {
    const scripts = defineScripts(() => {
      throw new Error("contribution failed");
    });

    await expect(resolveScripts([scripts], context)).rejects.toThrow(
      "contribution failed",
    );
  });
});
