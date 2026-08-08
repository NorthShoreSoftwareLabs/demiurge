import type {
  HtmlCapability,
  HttpRouteContext,
  JsonCapability,
  JsonLinesCapability,
  JsonLinesSource,
  MaybePromise,
  NotFoundCapability,
  RawResponseCapability,
  RedirectCapability,
  ResponseOptions,
  ResponseCapability,
  RouteValue,
  ServerTimingInput,
  ServerTimingMetric,
  ServerSentEvent,
  ServerSentEventsCapability,
  ServerSentEventSource,
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
    security: init?.security,
    timing: normalizeServerTiming(init?.timing),
    value,
    init: withoutRouteOptions(init),
  } satisfies JsonCapability<T>;
}

export function jsonl(
  lines: RouteValue<JsonLinesSource>,
  init?: ResponseOptions,
) {
  return {
    cors: init?.cors,
    init: withoutRouteOptions(init),
    kind: "jsonl",
    lines,
    security: init?.security,
    timing: normalizeServerTiming(init?.timing),
  } satisfies JsonLinesCapability;
}

export function text(value: RouteValue<string>, init?: ResponseOptions) {
  return {
    cors: init?.cors,
    kind: "text",
    security: init?.security,
    timing: normalizeServerTiming(init?.timing),
    value,
    init: withoutRouteOptions(init),
  } satisfies TextCapability;
}

export function html(value: RouteValue<string>, init?: ResponseOptions) {
  return {
    cors: init?.cors,
    kind: "html",
    security: init?.security,
    timing: normalizeServerTiming(init?.timing),
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
    security: options?.security,
    timing: normalizeServerTiming(options?.timing),
    to: isLinkTargetObject(to) ? href(to) : to,
    init: typeof init === "number" ? { status: init } : withoutRouteOptions(init),
  } satisfies RedirectCapability;
}

export function notFound(body?: RouteValue<string>, init?: ResponseOptions) {
  return {
    cors: init?.cors,
    kind: "not-found",
    security: init?.security,
    timing: normalizeServerTiming(init?.timing),
    body,
    init: withoutRouteOptions(init),
  } satisfies NotFoundCapability;
}

export function response(
  response: RouteValue<Response>,
  init?: Pick<ResponseOptions, "cors" | "security" | "timing">,
) {
  return {
    cors: init?.cors,
    kind: "response",
    response,
    security: init?.security,
    timing: normalizeServerTiming(init?.timing),
  } satisfies RawResponseCapability;
}

export function sse(
  events: RouteValue<ServerSentEventSource>,
  init?: ResponseOptions,
) {
  return {
    cors: init?.cors,
    events,
    init: withoutRouteOptions(init),
    kind: "sse",
    security: init?.security,
    timing: normalizeServerTiming(init?.timing),
  } satisfies ServerSentEventsCapability;
}

export function serverTiming(
  ...metrics: readonly ServerTimingMetric[]
): readonly ServerTimingMetric[] {
  return metrics;
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
    case "jsonl": {
      return new Response(
        createJsonLinesStream(await resolveValue(capability.lines, context)),
        {
          ...capability.init,
          headers: withDefaultHeaders(capability.init?.headers, {
            "cache-control": "no-cache",
            "content-type": "application/x-ndjson; charset=utf-8",
            "x-accel-buffering": "no",
          }),
        },
      );
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
    case "sse": {
      return new Response(
        createSseStream(await resolveValue(capability.events, context)),
        {
          ...capability.init,
          headers: withDefaultHeaders(capability.init?.headers, {
            "cache-control": "no-cache",
            "content-type": "text/event-stream; charset=utf-8",
            "x-accel-buffering": "no",
          }),
        },
      );
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
  return withDefaultHeaders(headers, { [name]: value });
}

function withDefaultHeaders(
  headers: HeadersInit | undefined,
  defaults: Record<string, string>,
) {
  const nextHeaders = new Headers(headers);

  for (const [name, value] of Object.entries(defaults)) {
    if (!nextHeaders.has(name)) {
      nextHeaders.set(name, value);
    }
  }

  return nextHeaders;
}

function createSseStream(events: ServerSentEventSource) {
  const encoder = new TextEncoder();
  const iterator = toAsyncIteratorSource(events);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();

      if (next.done) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(formatServerSentEvent(next.value)));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function createJsonLinesStream(lines: JsonLinesSource) {
  const encoder = new TextEncoder();
  const iterator = toAsyncIteratorSource(lines);

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await iterator.next();

      if (next.done) {
        controller.close();
        return;
      }

      controller.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`));
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

function toAsyncIteratorSource<T>(
  source: Iterable<T> | AsyncIterable<T> | ReadableStream<T>,
): AsyncIterator<T> {
  if (source instanceof ReadableStream) {
    const reader = source.getReader();

    return {
      async next() {
        return await reader.read();
      },
      async return() {
        reader.releaseLock();
        return { done: true, value: undefined };
      },
    };
  }

  if (Symbol.asyncIterator in source) {
    return source[Symbol.asyncIterator]();
  }

  return toAsyncIterator(source[Symbol.iterator]());
}

function toAsyncIterator<T>(iterator: Iterator<T>): AsyncIterator<T> {
  return {
    async next() {
      return iterator.next();
    },
    async return() {
      iterator.return?.();
      return { done: true, value: undefined };
    },
  };
}

function formatServerSentEvent(event: ServerSentEvent | string) {
  if (typeof event === "string") {
    return formatSseData(event);
  }

  const lines: string[] = [];

  if (event.comment !== undefined) {
    lines.push(...formatSseField("", event.comment));
  }

  if (event.id !== undefined) {
    lines.push(...formatSseField("id", event.id));
  }

  if (event.event !== undefined) {
    lines.push(...formatSseField("event", event.event));
  }

  if (event.retry !== undefined) {
    if (!Number.isInteger(event.retry) || event.retry < 0) {
      throw new Error("SSE retry must be a non-negative integer.");
    }

    lines.push(`retry: ${event.retry}`);
  }

  if (event.data !== undefined) {
    lines.push(...formatSseField("data", stringifySseData(event.data)));
  }

  return `${lines.join("\n")}\n\n`;
}

function formatSseData(data: string) {
  return `${formatSseField("data", data).join("\n")}\n\n`;
}

function formatSseField(name: string, value: string) {
  return value.split(/\r\n|\r|\n/).map((line) =>
    name ? `${name}: ${line}` : `: ${line}`,
  );
}

function stringifySseData(data: unknown) {
  return typeof data === "string" ? data : JSON.stringify(data);
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

  const {
    cors: _cors,
    security: _security,
    timing: _timing,
    ...responseInit
  } = options;
  return responseInit;
}

export function applyServerTimingHeader(
  response: Response,
  timing: readonly ServerTimingMetric[] | undefined,
) {
  if (!timing?.length) {
    return response;
  }

  const headers = new Headers(response.headers);
  const timingHeader = renderServerTimingHeader(timing);
  const existingTimingHeader = headers.get("server-timing");

  headers.set(
    "server-timing",
    existingTimingHeader
      ? `${existingTimingHeader}, ${timingHeader}`
      : timingHeader,
  );

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export function renderServerTimingHeader(
  timing: readonly ServerTimingMetric[],
) {
  return timing.map(renderServerTimingMetric).join(", ");
}

function normalizeServerTiming(timing: ServerTimingInput | undefined) {
  if (!timing) {
    return undefined;
  }

  return Array.isArray(timing) ? timing : [timing];
}

function renderServerTimingMetric(metric: ServerTimingMetric) {
  if (!isServerTimingToken(metric.name)) {
    throw new Error(
      `Server-Timing metric name "${metric.name}" is not a valid token.`,
    );
  }

  const parts = [metric.name];

  if (metric.duration !== undefined) {
    if (!Number.isFinite(metric.duration) || metric.duration < 0) {
      throw new Error("Server-Timing metric duration must be a non-negative finite number.");
    }

    parts.push(`dur=${formatServerTimingDuration(metric.duration)}`);
  }

  if (metric.description !== undefined) {
    parts.push(`desc="${escapeServerTimingDescription(metric.description)}"`);
  }

  return parts.join(";");
}

function isServerTimingToken(value: string) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

function formatServerTimingDuration(duration: number) {
  return Number.isInteger(duration) ? String(duration) : String(duration);
}

function escapeServerTimingDescription(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}
