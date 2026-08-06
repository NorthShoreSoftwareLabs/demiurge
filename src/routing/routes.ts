type PathInput = string | URL;

export type RouteBuilder<TInput = void> = TInput extends void
  ? (() => string) & { pattern: string }
  : ((input: TInput) => string) & { pattern: string };

export function route<TInput = void>(
  pattern: string,
  build?: (input: TInput) => PathInput,
) {
  const builder = ((input?: TInput) => {
    const value = build
      ? build(input as TInput)
      : pattern;

    return String(value);
  }) as RouteBuilder<TInput>;

  builder.pattern = pattern;

  return builder;
}

export function defineRoutes<const TRoutes>(routes: TRoutes) {
  return routes;
}
