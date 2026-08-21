import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  defineScripts,
  resolveScripts,
  Script,
  script,
} from "@demiurgejs/core";
import type { HttpRouteContext } from "@demiurgejs/core";
import type { ScriptProps } from "@demiurgejs/core";
import {
  createScriptRenderContext,
  scriptPlacement,
  withScriptContext,
} from "../../src/document/scripts";

const context = {
  context: {},
  path: {},
  pathname: "/checkout",
  request: new Request("https://example.test/checkout?payment=true"),
  search: new URLSearchParams("payment=true"),
  url: new URL("https://example.test/checkout?payment=true"),
} satisfies HttpRouteContext;

const managedScriptWithOverride: ScriptProps = {
  // @ts-expect-error Managed scripts receive the document nonce.
  nonce: "override",
  src: "https://cdn.example.com/app.js",
};
void managedScriptWithOverride;

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

  it("gives a static script precedence over a managed script with the same source", () => {
    const staticScript = script({
      id: "declared",
      src: "https://cdn.example.com/app.js",
      strategy: "beforeInteractive",
    });
    const context = createScriptRenderContext({ scripts: [staticScript] });

    expect(context.register(script({
      async: true,
      src: staticScript.src,
      strategy: "afterInteractive",
    }))).toBe("skip");
    expect(context.scripts()).toEqual([staticScript]);
  });

  it("hoists early managed scripts and renders late scripts in place", () => {
    const context = createScriptRenderContext({ dev: true });
    const early = script({ src: "https://cdn.example.com/early.js" });

    expect(context.register(early)).toBe("hoist");
    expect(context.scripts()).toEqual([
      { ...early, [scriptPlacement]: "hoisted" },
    ]);
  });

  it("reports a late beforeInteractive script in development", () => {
    const context = createScriptRenderContext({ dev: true });
    context.flushHead();

    expect(() => context.register(script({
      src: "https://cdn.example.com/late.js",
      strategy: "beforeInteractive",
    }))).toThrow(
      'Declare it in export const scripts.',
    );
  });

  it("renders a late beforeInteractive script in production", () => {
    const context = createScriptRenderContext();
    context.flushHead();

    expect(context.register(script({
      src: "https://cdn.example.com/late.js",
      strategy: "beforeInteractive",
    }))).toBe("render");
  });

  it("orders every supported strategy from earliest to latest", async () => {
    const scripts = await resolveScripts(
      [
        [
          script({ src: "/worker.js", strategy: "worker" }),
          script({
            src: "https://cdn.example.com/after.js",
            strategy: "afterInteractive",
          }),
          script({ src: "/idle.js", strategy: "idle" }),
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
      "/idle.js",
      "/worker.js",
    ]);
  });

  it("rejects a strategy that is not a supported name", () => {
    // SAFETY: the test passes an unsupported strategy name to verify the runtime rejection.
    expect(() =>
      script({
        src: "https://cdn.example.com/lazy.js",
        strategy: "whenVisible" as never,
      }),
    ).toThrow(/Unsupported script strategy "whenVisible"/);
  });

  it("rejects a worker strategy combined with a main-thread loading flag", () => {
    expect(() =>
      script({ async: true, src: "/worker.js", strategy: "worker" }),
    ).toThrow(/cannot be combined with async or defer/);
    expect(() =>
      script({ defer: true, src: "/worker.js", strategy: "worker" }),
    ).toThrow(/cannot be combined with async or defer/);
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

  it("renders a late idle Script as an inert placeholder in the streamed body", () => {
    const renderContext = createScriptRenderContext({ nonce: "doc-nonce" });
    renderContext.flushHead();

    const html = renderToString(
      withScriptContext(
        renderContext,
        createElement(Script, { src: "/vendor/idle-tag", strategy: "idle" }),
      ),
    );

    expect(html).toContain('type="text/demiurge-script"');
    expect(html).toContain('data-demiurge-script="idle"');
    expect(html).toContain('data-demiurge-script-src="/vendor/idle-tag"');
    expect(html).toContain('nonce="doc-nonce"');
    expect(html).not.toContain('src="/vendor/idle-tag"></script>');
  });

  it("rejects a server render that reaches Script without a script render context", () => {
    expect(() =>
      renderToString(
        createElement(Script, { src: "https://cdn.example.com/no-context.js" }),
      )
    ).toThrow(
      'The script "https://cdn.example.com/no-context.js" rendered outside a Demiurge document render context.',
    );
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
