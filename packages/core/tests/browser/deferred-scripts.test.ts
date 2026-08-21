// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getScriptWorker,
  startDeferredScripts,
} from "../../src/document/deferred-scripts";

type IdleStub = (
  callback: IdleRequestCallback,
  options?: IdleRequestOptions,
) => number;

const deadline: IdleDeadline = { didTimeout: false, timeRemaining: () => 0 };

function stubIdleCallback(stub: IdleStub) {
  Object.assign(window, { requestIdleCallback: stub });
}

function renderPlaceholder(markup: string) {
  document.body.innerHTML = markup;

  // SAFETY: the test renders a markup string that always includes a script element.
  return document.body.querySelector("script") as HTMLScriptElement;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  Reflect.deleteProperty(window, "requestIdleCallback");
  Reflect.deleteProperty(window, "Worker");
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("idle script scheduling", () => {
  it("leaves the placeholder inert until the idle callback runs", () => {
    const idleCallbacks: IdleRequestCallback[] = [];
    stubIdleCallback((callback) => idleCallbacks.push(callback));
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="idle" data-demiurge-script-src="/vendor/idle-tag"></script>',
    );

    startDeferredScripts();

    expect(document.querySelector('script[src="/vendor/idle-tag"]')).toBeNull();
    expect(idleCallbacks).toHaveLength(1);

    idleCallbacks[0]?.(deadline);

    const loaded = document.querySelector<HTMLScriptElement>(
      'script[src="/vendor/idle-tag"]',
    );

    expect(loaded?.async).toBe(true);
    expect(loaded?.parentElement).toBe(document.head);
  });

  it("asks the browser for an idle period with a timeout", () => {
    const requestIdleCallback = vi.fn<IdleStub>(() => 1);
    stubIdleCallback(requestIdleCallback);
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="idle" data-demiurge-script-src="/vendor/idle-tag"></script>',
    );

    startDeferredScripts();

    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 2_000,
    });
  });

  it("falls back to a macrotask when the browser has no idle callback", () => {
    vi.useFakeTimers();
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="idle" data-demiurge-script-src="/vendor/idle-tag"></script>',
    );

    startDeferredScripts();

    expect(document.querySelector('script[src="/vendor/idle-tag"]')).toBeNull();

    vi.advanceTimersByTime(1);

    expect(
      document.querySelector('script[src="/vendor/idle-tag"]'),
    ).not.toBeNull();
  });

  it("carries the placeholder identity, integrity, and type onto the loaded script", () => {
    vi.useFakeTimers();
    renderPlaceholder(
      '<script id="idle-tag" integrity="sha384-idle" referrerpolicy="no-referrer" data-api="/collect" data-domain="example.test" type="text/demiurge-script" data-demiurge-script="idle" data-demiurge-script-src="/vendor/idle-tag" data-demiurge-script-type="module" data-demiurge-script-placement="in-place"></script>',
    );

    startDeferredScripts();
    vi.advanceTimersByTime(1);

    const loaded = document.querySelector<HTMLScriptElement>(
      'script[src="/vendor/idle-tag"]',
    );

    expect(loaded?.id).toBe("idle-tag");
    expect(loaded?.getAttribute("integrity")).toBe("sha384-idle");
    expect(loaded?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(loaded?.type).toBe("module");
    expect(loaded?.dataset.api).toBe("/collect");
    expect(loaded?.dataset.domain).toBe("example.test");
    expect(loaded?.dataset.demiurgeScriptPlacement).toBe("in-place");
  });

  it("starts each placeholder once across repeated calls", () => {
    vi.useFakeTimers();
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="idle" data-demiurge-script-src="/vendor/idle-tag"></script>',
    );

    startDeferredScripts();
    startDeferredScripts();
    vi.advanceTimersByTime(1);

    expect(document.querySelectorAll('script[src="/vendor/idle-tag"]'))
      .toHaveLength(1);
  });

  it("loads nothing for a placeholder that declares no source", () => {
    vi.useFakeTimers();
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="idle"></script>',
    );

    startDeferredScripts();
    vi.advanceTimersByTime(1);

    expect(document.head.querySelector("script")).toBeNull();
  });

  it("ignores a placeholder that names an unknown strategy", () => {
    vi.useFakeTimers();
    const placeholder = renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="whenVisible" data-demiurge-script-src="/vendor/idle-tag"></script>',
    );

    startDeferredScripts();
    vi.advanceTimersByTime(1);

    expect(placeholder.isConnected).toBe(true);
    expect(document.querySelector('script[src="/vendor/idle-tag"]')).toBeNull();
  });

  it("works on a given document that has no browsing context", () => {
    vi.useFakeTimers();
    const owner = document.implementation.createHTMLDocument("detached");
    owner.body.innerHTML =
      '<script type="text/demiurge-script" data-demiurge-script="idle" data-demiurge-script-src="/vendor/idle-tag"></script>';

    startDeferredScripts(owner);
    vi.advanceTimersByTime(1);

    expect(owner.head.querySelector('script[src="/vendor/idle-tag"]'))
      .not.toBeNull();
    expect(document.head.querySelector("script")).toBeNull();
  });
});

describe("worker script scheduling", () => {
  const constructed: Array<[string, WorkerOptions | undefined]> = [];

  class FakeWorker {
    constructor(src: string | URL, options?: WorkerOptions) {
      constructed.push([String(src), options]);
    }
  }

  beforeEach(() => {
    constructed.length = 0;
  });

  it("constructs a worker for the declared source and exposes the handle", () => {
    Object.assign(window, { Worker: FakeWorker });
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="worker" data-demiurge-script-src="/vendor/worker-task"></script>',
    );

    startDeferredScripts();

    expect(constructed).toEqual([["/vendor/worker-task", { type: "classic" }]]);
    expect(getScriptWorker("/vendor/worker-task")).toBeInstanceOf(FakeWorker);
    expect(document.querySelector('script[src="/vendor/worker-task"]'))
      .toBeNull();
  });

  it("constructs a module worker when the placeholder declares a module type", () => {
    Object.assign(window, { Worker: FakeWorker });
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="worker" data-demiurge-script-src="/vendor/worker-module" data-demiurge-script-type="module"></script>',
    );

    startDeferredScripts();

    expect(constructed).toEqual([["/vendor/worker-module", { type: "module" }]]);
  });

  it("reports a runtime that cannot construct a worker", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="worker" data-demiurge-script-src="/vendor/worker-task"></script>',
    );

    startDeferredScripts();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("has no Worker constructor"),
    );
  });

  it("reports a worker the browser refuses to construct", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    Object.assign(window, {
      Worker: class {
        constructor() {
          throw new Error("blocked by worker-src");
        }
      },
    });
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="worker" data-demiurge-script-src="/vendor/blocked-worker"></script>',
    );

    startDeferredScripts();

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("/vendor/blocked-worker"),
      expect.any(Error),
    );
    expect(getScriptWorker("/vendor/blocked-worker")).toBeUndefined();
  });

  it("skips a worker placeholder that declares no source", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPlaceholder(
      '<script type="text/demiurge-script" data-demiurge-script="worker"></script>',
    );

    startDeferredScripts();

    expect(error).not.toHaveBeenCalled();
  });
});
