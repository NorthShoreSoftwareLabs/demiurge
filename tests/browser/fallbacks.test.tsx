// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createFileRouter } from "demiurge";

describe("browser router fallbacks", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("does not render framework-owned loading markup by default", () => {
    const Router = createFileRouter({ routes: {} });
    const result = render(<Router />);

    expect(result.container.textContent).toBe("");
  });

  it("renders app-provided loading UI", () => {
    const Router = createFileRouter({
      loading: Loading,
      routes: {},
    });

    render(<Router />);

    expect(screen.getByText("App loading")).toBeTruthy();
  });

  it("renders app-provided not-found UI", async () => {
    window.history.replaceState(null, "", "/missing");

    const Router = createFileRouter({
      notFound: NotFound,
      routes: {},
    });

    render(<Router />);

    await waitFor(() => {
      expect(screen.getByText("App not found: /missing")).toBeTruthy();
    });
  });
});

function Loading() {
  return <p>App loading</p>;
}

function NotFound({ pathname }: { pathname: string }) {
  return <p>App not found: {pathname}</p>;
}
