import type {
  HtmlCapability,
  HttpRouteContext,
  JsonCapability,
  MaybePromise,
  NotFoundCapability,
  RawResponseCapability,
  RedirectCapability,
  ResponseCapability,
  RouteValue,
  TextCapability,
} from "./types";

export function json<T>(
  value: JsonCapability<T>["value"],
  init?: ResponseInit,
) {
  return {
    kind: "json",
    value,
    init,
  } satisfies JsonCapability<T>;
}

export function text(value: RouteValue<string>, init?: ResponseInit) {
  return {
    kind: "text",
    value,
    init,
  } satisfies TextCapability;
}

export function html(value: RouteValue<string>, init?: ResponseInit) {
  return {
    kind: "html",
    value,
    init,
  } satisfies HtmlCapability;
}

export function redirect(
  to: RouteValue<string | URL>,
  init?: ResponseInit | number,
) {
  return {
    kind: "redirect",
    to,
    init: typeof init === "number" ? { status: init } : init,
  } satisfies RedirectCapability;
}

export function notFound(body?: RouteValue<string>, init?: ResponseInit) {
  return {
    kind: "not-found",
    body,
    init,
  } satisfies NotFoundCapability;
}

export function response(response: RouteValue<Response>) {
  return {
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
