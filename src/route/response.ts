import type {
  HtmlCapability,
  HttpRouteContext,
  JsonCapability,
  MaybePromise,
  NotFoundCapability,
  RawResponseCapability,
  RedirectCapability,
  ResponseOptions,
  ResponseCapability,
  RouteValue,
  TextCapability,
} from "./types";
import { href, type AppHref, type LinkTarget } from "../routing";

export function json<T>(
  value: JsonCapability<T>["value"],
  init?: ResponseOptions,
) {
  return {
    cors: init?.cors,
    kind: "json",
    value,
    init: withoutRouteOptions(init),
  } satisfies JsonCapability<T>;
}

export function text(value: RouteValue<string>, init?: ResponseOptions) {
  return {
    cors: init?.cors,
    kind: "text",
    value,
    init: withoutRouteOptions(init),
  } satisfies TextCapability;
}

export function html(value: RouteValue<string>, init?: ResponseOptions) {
  return {
    cors: init?.cors,
    kind: "html",
    value,
    init: withoutRouteOptions(init),
  } satisfies HtmlCapability;
}

export function redirect<const TTo extends AppHref>(
  to: LinkTarget<TTo>,
  init?: ResponseOptions | number,
): RedirectCapability;
export function redirect(
  to: RouteValue<string | URL>,
  init?: ResponseOptions | number,
): RedirectCapability;
export function redirect(
  to: LinkTarget | RouteValue<string | URL>,
  init?: ResponseOptions | number,
) {
  const options = typeof init === "number" ? undefined : init;

  return {
    cors: options?.cors,
    kind: "redirect",
    to: isLinkTargetObject(to) ? href(to) : to,
    init: typeof init === "number" ? { status: init } : withoutRouteOptions(init),
  } satisfies RedirectCapability;
}

export function notFound(body?: RouteValue<string>, init?: ResponseOptions) {
  return {
    cors: init?.cors,
    kind: "not-found",
    body,
    init: withoutRouteOptions(init),
  } satisfies NotFoundCapability;
}

export function response(
  response: RouteValue<Response>,
  init?: Pick<ResponseOptions, "cors">,
) {
  return {
    cors: init?.cors,
    kind: "response",
    response,
  } satisfies RawResponseCapability;
}

export async function toResponse(
  capability: ResponseCapability,
  context: HttpRouteContext,
) {
  switch (capability.kind) {
    case "json": {
      return new Response(JSON.stringify(await resolveValue(capability.value, context)), {
        ...capability.init,
        headers: withDefaultHeader(
          capability.init?.headers,
          "content-type",
          "application/json; charset=utf-8",
        ),
      });
    }
    case "text": {
      return new Response(await resolveValue(capability.value, context), {
        ...capability.init,
        headers: withDefaultHeader(
          capability.init?.headers,
          "content-type",
          "text/plain; charset=utf-8",
        ),
      });
    }
    case "html": {
      return new Response(await resolveValue(capability.value, context), {
        ...capability.init,
        headers: withDefaultHeader(
          capability.init?.headers,
          "content-type",
          "text/html; charset=utf-8",
        ),
      });
    }
    case "redirect": {
      const headers = new Headers(capability.init?.headers);
      headers.set("location", String(await resolveValue(capability.to, context)));

      return new Response(null, {
        ...capability.init,
        headers,
        status: capability.init?.status ?? 302,
      });
    }
    case "not-found": {
      return new Response(
        capability.body ? await resolveValue(capability.body, context) : null,
        {
          ...capability.init,
          status: capability.init?.status ?? 404,
        },
      );
    }
    case "response": {
      return await resolveValue(capability.response, context);
    }
  }
}

async function resolveValue<T>(
  value: RouteValue<T>,
  context: HttpRouteContext,
) {
  if (typeof value !== "function") {
    return value;
  }

  return await (value as (context: HttpRouteContext) => MaybePromise<T>)(
    context,
  );
}

function withDefaultHeader(
  headers: HeadersInit | undefined,
  name: string,
  value: string,
) {
  const nextHeaders = new Headers(headers);

  if (!nextHeaders.has(name)) {
    nextHeaders.set(name, value);
  }

  return nextHeaders;
}

function isLinkTargetObject(value: unknown): value is LinkTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    !(value instanceof URL) &&
    "to" in value
  );
}

function withoutRouteOptions(options: ResponseOptions | undefined) {
  if (!options) {
    return undefined;
  }

  const { cors: _cors, ...responseInit } = options;
  return responseInit;
}
