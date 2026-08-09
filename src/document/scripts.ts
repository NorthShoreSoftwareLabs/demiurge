import type { HttpRouteContext, MaybePromise } from "../route";

export type ScriptStrategy =
  | "afterInteractive"
  | "beforeInteractive"
  | "idle"
  | "module"
  | "visible"
  | "worker";

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
  return {
    ...options,
    kind: "script",
    strategy: options.strategy ?? "afterInteractive",
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

  if (strategy === "afterInteractive") {
    return 2;
  }

  if (strategy === "idle") {
    return 3;
  }

  if (strategy === "visible") {
    return 4;
  }

  return 5;
}
