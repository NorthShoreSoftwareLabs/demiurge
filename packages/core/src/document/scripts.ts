import {
  createContext,
  createElement,
  useContext,
  type ReactNode,
} from "react";
import type { HttpRouteContext, MaybePromise } from "../route";

export type ScriptStrategy =
  | "afterInteractive"
  | "beforeInteractive"
  | "module";

const SCRIPT_STRATEGIES = new Set<ScriptStrategy>([
  "afterInteractive",
  "beforeInteractive",
  "module",
]);

export const scriptPlacement = Symbol("demiurge.scriptPlacement");

export type ScriptTag = {
  async?: boolean;
  dataApi?: string;
  dataDomain?: string;
  defer?: boolean;
  id?: string;
  integrity?: string;
  kind: "script";
  nonce?: string;
  purpose?: string;
  referrerPolicy?: ReferrerPolicy;
  src: string;
  strategy: ScriptStrategy;
  type?: "module" | "text/javascript";
  [scriptPlacement]?: "hoisted" | "in-place";
};

export type ScriptContribution =
  | readonly ScriptTag[]
  | ((context: HttpRouteContext) => MaybePromise<readonly ScriptTag[]>);

export type ScriptProps = Omit<
  ScriptTag,
  "kind" | "nonce" | "strategy" | typeof scriptPlacement
> & {
  strategy?: ScriptStrategy;
};

export type ScriptRenderContext = {
  dev: boolean;
  headFlushed: boolean;
  flushHead: () => void;
  nonce?: string;
  register: (scriptTag: ScriptTag) => "hoist" | "render" | "skip";
  scripts: () => ScriptTag[];
};

export const ScriptContext = createContext<ScriptRenderContext | undefined>(
  undefined,
);

export function createScriptRenderContext(options: {
  dev?: boolean;
  nonce?: string;
  scripts?: readonly ScriptTag[];
} = {}): ScriptRenderContext {
  let headFlushed = false;
  const staticScripts = [...(options.scripts ?? [])];
  const staticSources = new Set(staticScripts.map((tag) => tag.src));
  const registeredSources = new Set<string>();
  const hoisted = new Map<string, ScriptTag>();

  return {
    get dev() {
      return options.dev ?? false;
    },
    get headFlushed() {
      return headFlushed;
    },
    flushHead() {
      headFlushed = true;
    },
    nonce: options.nonce,
    register(scriptTag) {
      if (staticSources.has(scriptTag.src) || registeredSources.has(scriptTag.src)) {
        return "skip";
      }

      registeredSources.add(scriptTag.src);

      if (!headFlushed) {
        hoisted.set(scriptTag.src, {
          ...scriptTag,
          [scriptPlacement]: "hoisted",
        });
        return "hoist";
      }

      if (scriptTag.strategy === "beforeInteractive" && (options.dev ?? false)) {
        throw new Error(
          `A render-discovered beforeInteractive script ${JSON.stringify(scriptTag.src)} was found after the document head flushed. Declare it in export const scripts.`,
        );
      }

      return "render";
    },
    scripts() {
      return sortScripts([...staticScripts, ...hoisted.values()]);
    },
  };
}

export function Script(props: ScriptProps): ReactNode {
  const context = useContext(ScriptContext);
  const scriptTag = script(props);

  if (!context) {
    if (typeof document === "undefined") {
      throw new Error(
        `The script ${JSON.stringify(scriptTag.src)} rendered outside a Demiurge document render context. A server render must wrap its component tree with the script render context.`,
      );
    }

    if (hasExistingScript(scriptTag.src)) {
      return null;
    }

    return renderScriptElement({
      ...scriptTag,
      [scriptPlacement]: "in-place",
    }, documentNonce());
  }

  const placement = context.register(scriptTag);

  if (placement !== "render") {
    return null;
  }

  return renderScriptElement({
    ...scriptTag,
    [scriptPlacement]: "in-place",
  }, context.nonce);
}

function renderScriptElement(scriptTag: ScriptTag, nonce?: string) {
  return createElement("script", {
    async: scriptTag.async,
    "data-api": scriptTag.dataApi,
    "data-domain": scriptTag.dataDomain,
    "data-demiurge-script-placement": scriptTag[scriptPlacement],
    defer: scriptTag.defer,
    id: scriptTag.id,
    integrity: scriptTag.integrity,
    nonce: scriptTag.nonce ?? nonce,
    referrerPolicy: scriptTag.referrerPolicy,
    src: scriptTag.src,
    type: scriptTag.type ?? scriptTypeForStrategy(scriptTag.strategy),
  });
}

function hasExistingScript(src: string) {
  if (typeof document === "undefined") {
    return false;
  }

  const expected = new URL(src, document.baseURI).href;

  return [...document.scripts].some((element) =>
    element.src === expected &&
    element.dataset.demiurgeScriptPlacement !== "in-place"
  );
}

function documentNonce() {
  if (typeof document === "undefined") {
    return undefined;
  }

  return [...document.scripts].reverse().find((element) => element.nonce)?.nonce;
}

export function defineScripts(contribution: ScriptContribution) {
  return contribution;
}

export function script(options: Omit<ScriptTag, "kind" | "strategy"> & {
  strategy?: ScriptStrategy;
}): ScriptTag {
  const strategy = options.strategy ?? "afterInteractive";

  if (!SCRIPT_STRATEGIES.has(strategy)) {
    throw new Error(
      `Unsupported script strategy ${JSON.stringify(strategy)}. Demiurge 0.1 supports "beforeInteractive", "module", and "afterInteractive"; deferred, visibility-triggered, and worker loading require a future client script runtime.`,
    );
  }

  if (strategy === "module" && options.type && options.type !== "module") {
    throw new Error(
      'The "module" script strategy cannot be combined with type="text/javascript".',
    );
  }

  return {
    ...options,
    kind: "script",
    strategy,
  };
}

export function withScriptContext(
  context: ScriptRenderContext,
  children: ReactNode,
) {
  return createElement(ScriptContext.Provider, { value: context, children });
}

export async function resolveScripts(
  contributions: Array<ScriptContribution | false | undefined>,
  context: HttpRouteContext,
) {
  const scripts: ScriptTag[] = [];

  for (const contribution of contributions) {
    if (!contribution) {
      continue;
    }

    const resolved =
      typeof contribution === "function"
        ? await contribution(context)
        : contribution;

    scripts.push(...resolved);
  }

  return sortScripts(dedupeScripts(scripts));
}

function dedupeScripts(scripts: ScriptTag[]) {
  const deduped = new Map<string, ScriptTag>();

  for (const scriptTag of scripts) {
    deduped.set(scriptKey(scriptTag), {
      ...deduped.get(scriptKey(scriptTag)),
      ...scriptTag,
    });
  }

  return [...deduped.values()];
}

function scriptKey(scriptTag: ScriptTag) {
  return [
    scriptTag.src,
    scriptTag.type ?? "",
    scriptTag.integrity ?? "",
    scriptTag.strategy,
  ].join("\0");
}

function compareScripts(left: ScriptTag, right: ScriptTag) {
  return (
    scriptStrategyOrder(left.strategy) - scriptStrategyOrder(right.strategy) ||
    left.src.localeCompare(right.src)
  );
}

function sortScripts(scripts: ScriptTag[]) {
  return scripts.sort(compareScripts);
}

function scriptTypeForStrategy(strategy: ScriptTag["strategy"]) {
  return strategy === "module" ? "module" : undefined;
}

function scriptStrategyOrder(strategy: ScriptStrategy) {
  if (strategy === "beforeInteractive") {
    return 0;
  }

  if (strategy === "module") {
    return 1;
  }

  return 2;
}
