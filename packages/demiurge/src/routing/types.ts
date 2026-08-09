export type PathValue = string | number | boolean;
export type PathVars = Record<string, string>;

export interface RoutePathVars {}

export interface RouteConcretePaths {}

type KnownRoutePath = keyof RoutePathVars & string;
type KnownConcretePath = RouteConcretePaths[keyof RouteConcretePaths] & string;
type HasGeneratedRoutes = [KnownRoutePath] extends [never] ? false : true;

export type AppPath = HasGeneratedRoutes extends true ? KnownRoutePath : string;

export type AppHref = HasGeneratedRoutes extends true
  ? KnownRoutePath | KnownConcretePath
  : string;

export type PathVarsFor<TPath extends string> =
  TPath extends KnownRoutePath ? RoutePathVars[TPath] : never;

export type RouteParamsFor<TPath extends string> =
  TPath extends KnownRoutePath
    ? { [K in keyof RoutePathVars[TPath]]: string }
    : PathVars;

type HasPathVars<TPath extends string> =
  keyof PathVarsFor<TPath> extends never ? false : true;

export type LinkTo<TTo extends AppHref = AppHref> =
  TTo extends KnownRoutePath
    ? HasPathVars<TTo> extends true
      ? { to: TTo; path: PathVarsFor<TTo> }
      : { to: TTo; path?: never }
    : { to: TTo; path?: never };

export type LinkTarget<TTo extends AppHref = AppHref> = TTo | LinkTo<TTo>;

export function href<const TTo extends AppHref>(target: LinkTarget<TTo>) {
  if (typeof target === "string") {
    return target;
  }

  return fillPath(target.to, "path" in target ? target.path : undefined);
}

function fillPath(pattern: string, path: Record<string, PathValue> | undefined) {
  if (!path) {
    return pattern;
  }

  return pattern.replace(
    /\[(\.\.\.)?([a-zA-Z_$][a-zA-Z0-9_$]*)\]/g,
    (_match, catchall: string | undefined, name: string) => {
      const value = path[name];

      if (value === undefined) {
        throw new Error(`Missing path value for "${name}" in route "${pattern}".`);
      }

      if (catchall) {
        return String(value)
          .split("/")
          .filter(Boolean)
          .map((segment) => encodeURIComponent(segment))
          .join("/");
      }

      return encodeURIComponent(String(value));
    },
  );
}
