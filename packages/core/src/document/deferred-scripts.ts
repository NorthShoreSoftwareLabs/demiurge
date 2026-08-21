import type { ScriptStrategy } from "./scripts";
import { createFrameworkScriptUrl } from "./trusted-types";

// A deferred strategy cannot be a plain script tag, because the browser fetches
// and runs a plain script tag as soon as it parses one. The document therefore
// carries an inert placeholder element. The client runtime finds the
// placeholder after hydration and starts the real work.
export const DEFERRED_SCRIPT_TYPE = "text/demiurge-script";
export const DEFERRED_SCRIPT_ATTRIBUTE = "data-demiurge-script";
export const DEFERRED_SCRIPT_SRC_ATTRIBUTE = "data-demiurge-script-src";
export const DEFERRED_SCRIPT_TYPE_ATTRIBUTE = "data-demiurge-script-type";
export const DEFERRED_SCRIPT_STARTED_ATTRIBUTE = "data-demiurge-script-started";

// An idle callback that never gets an idle period would never run the script.
// The timeout makes the browser run it anyway once the deadline passes.
const IDLE_TIMEOUT_MS = 2_000;

const COPIED_ATTRIBUTES = [
  "data-api",
  "data-demiurge-script-placement",
  "data-domain",
  "id",
  "integrity",
  "referrerpolicy",
] as const;

export type DeferredScriptStrategy = "idle" | "worker";

const workers = new Map<string, Worker>();

export function isDeferredScriptStrategy(
  strategy: ScriptStrategy,
): strategy is DeferredScriptStrategy {
  return strategy === "idle" || strategy === "worker";
}

// The client entry calls this after it hands the document to React. Repeated
// calls are safe, because every placeholder is marked once it starts.
export function startDeferredScripts(target?: Document) {
  const owner = target ?? (typeof document === "undefined" ? undefined : document);

  if (!owner) {
    return;
  }

  const placeholders = owner.querySelectorAll<HTMLScriptElement>(
    `script[${DEFERRED_SCRIPT_ATTRIBUTE}]:not([${DEFERRED_SCRIPT_STARTED_ATTRIBUTE}])`,
  );

  for (const placeholder of [...placeholders]) {
    const strategy = placeholder.getAttribute(DEFERRED_SCRIPT_ATTRIBUTE);

    if (strategy !== "idle" && strategy !== "worker") {
      continue;
    }

    placeholder.setAttribute(DEFERRED_SCRIPT_STARTED_ATTRIBUTE, "");

    if (strategy === "worker") {
      startScriptWorker(placeholder);
      continue;
    }

    scheduleIdleCallback(placeholder, () => loadIdleScript(placeholder));
  }
}

// A worker strategy script runs off the main thread, so the application talks
// to it through the worker handle. The client entry starts every worker before
// React runs a route effect, so a route can read the handle on mount.
export function getScriptWorker(src: string) {
  return workers.get(src);
}

function scheduleIdleCallback(
  placeholder: HTMLScriptElement,
  callback: () => void,
) {
  const view = placeholder.ownerDocument.defaultView;

  if (view && typeof view.requestIdleCallback === "function") {
    view.requestIdleCallback(() => callback(), { timeout: IDLE_TIMEOUT_MS });
    return;
  }

  // Browsers without requestIdleCallback fall back to a macrotask. The script
  // still runs after the current task, and it still never blocks hydration.
  const timers = view ?? globalThis;
  timers.setTimeout(callback, 1);
}

// The placeholder stays in the document, because a component render can own it
// and React must keep the node it created. The loaded script goes to the head
// instead, which is where a script added after parsing normally belongs.
function loadIdleScript(placeholder: HTMLScriptElement) {
  const owner = placeholder.ownerDocument;
  const src = placeholder.getAttribute(DEFERRED_SCRIPT_SRC_ATTRIBUTE);

  if (!src) {
    return;
  }

  const element = owner.createElement("script");
  const type = placeholder.getAttribute(DEFERRED_SCRIPT_TYPE_ATTRIBUTE);

  for (const name of COPIED_ATTRIBUTES) {
    const value = placeholder.getAttribute(name);

    if (value !== null) {
      element.setAttribute(name, value);
    }
  }

  // Only one element can own an identifier, so the loaded script takes it.
  placeholder.removeAttribute("id");

  if (type) {
    element.type = type;
  }

  // A script element created after parsing is always async. The nonce carries
  // over for policies that list a nonce without strict-dynamic.
  element.async = true;
  element.nonce = placeholder.nonce;
  element.src = createFrameworkScriptUrl(owner.defaultView, src);
  owner.head.appendChild(element);
}

function startScriptWorker(placeholder: HTMLScriptElement) {
  const src = placeholder.getAttribute(DEFERRED_SCRIPT_SRC_ATTRIBUTE);
  const view = placeholder.ownerDocument.defaultView;

  if (!src) {
    return;
  }

  // The worker strategy is client-only by construction. A server render and a
  // static export have no Worker constructor. The strategy reports that gap
  // instead of falling back to the main thread.
  if (!view || typeof view.Worker !== "function") {
    console.error(
      `Demiurge could not start the worker script ${JSON.stringify(src)}. This runtime has no Worker constructor.`,
    );
    return;
  }

  const type = placeholder.getAttribute(DEFERRED_SCRIPT_TYPE_ATTRIBUTE);

  try {
    workers.set(
      src,
      new view.Worker(createFrameworkScriptUrl(view, src), {
        type: type === "module" ? "module" : "classic",
      }),
    );
  } catch (error) {
    // A worker URL has to be same-origin or a blob URL, and the document policy
    // has to allow it through worker-src. Report the refusal instead of
    // falling back to the main thread, which would defeat the strategy.
    console.error(
      `Demiurge could not start the worker script ${JSON.stringify(src)}.`,
      error,
    );
  }
}
