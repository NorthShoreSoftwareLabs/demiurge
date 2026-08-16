// @vitest-environment jsdom

import { act } from "@testing-library/react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { Script, type ScriptProps } from "@demiurgejs/core";

async function renderScript(props: ScriptProps) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(Script, props));
  });

  return {
    container,
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("Script rendered without a script render context in a browser", () => {
  afterEach(() => {
    for (const element of [...document.head.querySelectorAll("script")]) {
      element.remove();
    }
  });

  it("renders inline when no existing script shares its source", async () => {
    const { container, unmount } = await renderScript({
      src: "https://cdn.example.com/first-render.js",
    });

    const rendered = container.querySelector("script");

    expect(rendered?.getAttribute("src")).toBe(
      "https://cdn.example.com/first-render.js",
    );
    expect(rendered?.dataset.demiurgeScriptPlacement).toBe("in-place");

    await unmount();
  });

  it("dedupes against a script already in the document", async () => {
    const existing = document.createElement("script");
    existing.src = "https://cdn.example.com/existing.js";
    document.head.appendChild(existing);

    const { container, unmount } = await renderScript({
      src: "https://cdn.example.com/existing.js",
    });

    expect(container.querySelector("script")).toBeNull();

    await unmount();
  });

  it("does not dedupe against a script marked in-place", async () => {
    const existing = document.createElement("script");
    existing.src = "https://cdn.example.com/in-place.js";
    existing.dataset.demiurgeScriptPlacement = "in-place";
    document.head.appendChild(existing);

    const { container, unmount } = await renderScript({
      src: "https://cdn.example.com/in-place.js",
    });

    expect(container.querySelector("script")).not.toBeNull();

    await unmount();
  });

  it("picks up the nonce from an existing script", async () => {
    const existing = document.createElement("script");
    existing.src = "https://cdn.example.com/vite-client.js";
    existing.nonce = "existing-nonce";
    document.head.appendChild(existing);

    const { container, unmount } = await renderScript({
      src: "https://cdn.example.com/needs-nonce.js",
    });

    const rendered = container.querySelector("script");

    expect(rendered?.nonce).toBe("existing-nonce");

    await unmount();
  });
});
