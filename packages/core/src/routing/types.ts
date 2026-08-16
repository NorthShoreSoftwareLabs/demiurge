export type PathValue = string | number | boolean;
export type SearchValue = PathValue | null | undefined;
export type SearchValues = Record<
  string,
  SearchValue | readonly SearchValue[]
>;
export type PathVars = Record<string, string>;

export interface RoutePathVars {}

export interface RouteConcretePaths {}

export interface RouteRequestContexts {}

type KnownRoutePath = keyof RoutePathVars & string;
type KnownConcretePath = RouteConcretePaths[keyof RouteConcretePaths] & string;
type HasGeneratedRoutes = [KnownRoutePath] extends [never] ? false : true;
type WithUrlSuffix<TPath extends string> =
  | TPath
  | `${TPath}?${string}`
  | `${TPath}#${string}`
  | `${TPath}?${string}#${string}`;
type PathnameOf<THref extends string> =
  THref extends `${infer TWithoutHash}#${string}`
    ? TWithoutHash extends `${infer TPath}?${string}` ? TPath : TWithoutHash
    : THref extends `${infer TPath}?${string}` ? TPath : THref;

export type AppPath = HasGeneratedRoutes extends true ? KnownRoutePath : string;

export type AppHref = HasGeneratedRoutes extends true
  ? WithUrlSuffix<KnownRoutePath | KnownConcretePath>
  : string;

export type PathVarsFor<TPath extends string> =
  TPath extends KnownRoutePath ? RoutePathVars[TPath] : never;

export type RouteParamsFor<TPath extends string> =
  TPath extends KnownRoutePath
    ? { [K in keyof RoutePathVars[TPath]]: string }
    : PathVars;

type HasPathVars<TPath extends string> =
  keyof PathVarsFor<TPath> extends never ? false : true;

type LinkOptions = {
  hash?: string;
  search?: string | URLSearchParams | SearchValues;
};

export type LinkTo<TTo extends AppHref = AppHref> = LinkOptions & (
  PathnameOf<TTo> extends KnownRoutePath
    ? HasPathVars<PathnameOf<TTo>> extends true
      ? { to: TTo; path: PathVarsFor<PathnameOf<TTo>> }
      : { to: TTo; path?: never }
    : { to: TTo; path?: never }
);

export type LinkTarget<TTo extends AppHref = AppHref> = TTo | LinkTo<TTo>;

export function href<const TTo extends AppHref>(target: LinkTarget<TTo>) {
  if (typeof target === "string") {
    return target;
  }

  const embedded = splitHref(fillPath(
    target.to,
    "path" in target ? target.path : undefined,
  ));
  const search = target.search === undefined
    ? embedded.search
    : serializeSearch(target.search);
  const hash = target.hash === undefined
    ? embedded.hash
    : target.hash
      ? target.hash.startsWith("#") ? target.hash : `#${target.hash}`
      : "";

  return `${embedded.pathname}${search}${hash}`;
}

function splitHref(value: string) {
  const hashIndex = value.indexOf("#");
  const beforeHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const searchIndex = beforeHash.indexOf("?");

  return {
    hash: hashIndex === -1 ? "" : value.slice(hashIndex),
    pathname: searchIndex === -1
      ? beforeHash
      : beforeHash.slice(0, searchIndex),
    search: searchIndex === -1 ? "" : beforeHash.slice(searchIndex),
  };
}

function serializeSearch(search: LinkOptions["search"]) {
  if (!search) {
    return "";
  }

  if (typeof search === "string") {
    return search.startsWith("?") ? search : `?${search}`;
  }

  const params = search instanceof URLSearchParams
    ? search
    : createSearchParams(search);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function createSearchParams(search: SearchValues) {
  const params = new URLSearchParams();

  for (const [name, rawValue] of Object.entries(search)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    for (const value of values) {
      if (value !== null && value !== undefined) {
        params.append(name, String(value));
      }
    }
  }

  return params;
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
