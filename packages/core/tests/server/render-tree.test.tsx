import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveMetadata, Script } from "@demiurgejs/core";
import type { RouteProps } from "@demiurgejs/core";
import { createPageRenderTree } from "../../src/server/render-tree";
import type { LoadedRouteMatch } from "../../src/router";

function createMatch(): LoadedRouteMatch {
  return {
    layouts: [],
    links: [],
    metadata: resolveMetadata(),
    page: (_props: RouteProps<string, unknown>) => (
      <Script src="https://cdn.example.com/app.js" />
    ),
    path: {},
    pathname: "/",
    render: { mode: "streaming" },
    scripts: [],
  };
}

describe("createPageRenderTree", () => {
  it("renders the page tree directly when called without a script render context", () => {
    const match = createMatch();

    expect(() => renderToString(createPageRenderTree(match))).toThrow(
      "rendered outside a Demiurge document render context",
    );
  });
});
