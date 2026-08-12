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
};

export type ScriptContribution =
  | readonly ScriptTag[]
  | ((context: HttpRouteContext) => MaybePromise<readonly ScriptTag[]>);

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

  return dedupeScripts(scripts).sort(compareScripts);
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

function scriptStrategyOrder(strategy: ScriptStrategy) {
  if (strategy === "beforeInteractive") {
    return 0;
  }

  if (strategy === "module") {
    return 1;
  }

  return 2;
}
