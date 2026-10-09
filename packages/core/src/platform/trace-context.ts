import type { RuntimeSpanContext } from "./runtime-instrumentation";

export type W3CTraceContext = Readonly<{
  isRemote: true;
  sampled: boolean;
  spanId: string;
  traceFlags: number;
  traceId: string;
  traceState?: string;
}>;

export type RuntimeTraceContextPropagator = {
  allowBaggage?: boolean;
  extract?: (
    headers: Headers,
    fallback: W3CTraceContext,
  ) => RuntimeSpanContext | undefined;
  inject?: (context: RuntimeSpanContext, headers: Headers) => void;
};

export type RuntimeTraceCarrier = {
  context?: RuntimeSpanContext;
  inject: (headers: Headers) => void;
};

const traceparentPattern = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(.*)$/;
const traceStateSimpleKeyPattern = /^[a-z][_a-z0-9*/-]{0,255}$/;
const traceStateTenantKeyPattern = /^[a-z0-9][_a-z0-9*/-]{0,240}$/;
const traceStateSystemKeyPattern = /^[a-z][_a-z0-9*/-]{0,13}$/;
const traceStateValuePattern = /^[\x20-\x2b\x2d-\x3c\x3e-\x7e]{1,256}$/;

export function parseTraceContext(headers: Headers): W3CTraceContext | undefined {
  const traceparent = headers.get("traceparent");
  if (!traceparent || traceparent.length > 512) return undefined;

  const match = traceparentPattern.exec(traceparent);
  if (!match) return undefined;

  const [, version, traceId, spanId, flags, extra] = match;
  if (
    version.toLowerCase() === "ff" ||
    traceId.toLowerCase() === "00000000000000000000000000000000" ||
    spanId.toLowerCase() === "0000000000000000"
  ) {
    return undefined;
  }

  if (
    version.toLowerCase() === "00"
      ? extra !== ""
      : traceparent.length < 55 || (extra !== "" && !extra.startsWith("-"))
  ) {
    return undefined;
  }

  const traceFlags = Number.parseInt(flags, 16);
  const traceState = parseTraceState(headers.get("tracestate"));

  return {
    isRemote: true,
    sampled: (traceFlags & 1) === 1,
    spanId: spanId.toLowerCase(),
    traceFlags,
    traceId: traceId.toLowerCase(),
    ...(traceState ? { traceState } : {}),
  };
}

export function injectTraceContext(
  headers: Headers,
  context: RuntimeSpanContext | undefined,
) {
  if (!context) return false;

  const traceId = readHex(context.traceId, 32);
  const spanId = readHex(context.spanId, 16);
  const traceFlags = readTraceFlags(context.traceFlags);
  if (
    !traceId ||
    !spanId ||
    traceId === "00000000000000000000000000000000" ||
    spanId === "0000000000000000" ||
    traceFlags === undefined
  ) {
    return false;
  }

  headers.set("traceparent", `00-${traceId}-${spanId}-${traceFlags & 1 ? "01" : "00"}`);
  const traceState = typeof context.traceState === "string"
    ? parseTraceState(context.traceState)
    : undefined;
  if (traceState) headers.set("tracestate", traceState);
  else headers.delete("tracestate");
  return true;
}

export function createRuntimeTraceCarrier(
  context: RuntimeSpanContext | undefined,
  propagator?: RuntimeTraceContextPropagator,
): RuntimeTraceCarrier {
  return {
    context,
    inject(headers) {
      if (!context) return;

      const original = new Headers(headers);
      const outgoing = new Headers(headers);
      const originalBaggage = original.get("baggage");
      if (!propagator?.allowBaggage) outgoing.delete("baggage");
      try {
        if (propagator?.inject) propagator.inject(context, outgoing);
        else injectTraceContext(outgoing, context);
      } catch {
        return;
      }

      if (!propagator?.allowBaggage) {
        if (originalBaggage) outgoing.set("baggage", originalBaggage);
      }
      if (outgoing.has("traceparent")) {
        const parsed = parseTraceContext(outgoing);
        if (!parsed) return;
        if (!parsed.traceState) outgoing.delete("tracestate");
      }

      try {
        const names = new Set([...original.keys(), ...outgoing.keys()]);
        for (const name of names) {
          if (
            (name === "baggage" && !propagator?.allowBaggage) ||
            sameHeaderValues(original, outgoing, name)
          ) continue;
          headers.delete(name);
          appendHeaderValues(headers, outgoing, name);
        }
      } catch {
        return;
      }
    },
  };
}

function sameHeaderValues(left: Headers, right: Headers, name: string) {
  return headerValues(left, name).join("\u0000") ===
    headerValues(right, name).join("\u0000");
}

function headerValues(headers: Headers, name: string) {
  if (name === "set-cookie") {
    const getSetCookie = Reflect.get(headers, "getSetCookie");
    if (typeof getSetCookie === "function") return getSetCookie.call(headers);
  }
  const value = headers.get(name);
  return value === null ? [] : [value];
}

function appendHeaderValues(target: Headers, source: Headers, name: string) {
  for (const value of headerValues(source, name)) target.append(name, value);
}

export function extractRuntimeTraceContext(
  headers: Headers,
  propagator?: RuntimeTraceContextPropagator,
) {
  const fallback = parseTraceContext(headers);
  if (!fallback) return undefined;
  if (!propagator?.extract) return fallback;

  try {
    const carrier = new Headers({
      traceparent: `00-${fallback.traceId}-${fallback.spanId}-${fallback.sampled ? "01" : "00"}`,
    });
    if (fallback.traceState) carrier.set("tracestate", fallback.traceState);
    if (propagator.allowBaggage) {
      const baggage = headers.get("baggage");
      if (baggage) carrier.set("baggage", baggage);
    }
    return propagator.extract(carrier, fallback) ?? fallback;
  } catch {
    return fallback;
  }
}

function readHex(value: unknown, length: number) {
  if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`, "i").test(value)) {
    return undefined;
  }
  return value.toLowerCase();
}

function readTraceFlags(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255) {
    return value;
  }
  if (typeof value === "string" && /^[0-9a-f]{2}$/i.test(value)) {
    return Number.parseInt(value, 16);
  }
  return undefined;
}

function parseTraceState(value: string | null) {
  if (value === null || value === "" || value.length > 512) return undefined;

  const members = value.split(",").map((member) => member.replace(/^[ \t]+|[ \t]+$/g, ""));
  if (members.length > 32 || members.some((member) => member && !isTraceStateMember(member))) {
    return undefined;
  }

  const keys = new Set<string>();
  for (const member of members) {
    if (!member) continue;
    const separator = member.indexOf("=");
    const key = member.slice(0, separator);
    if (keys.has(key)) return undefined;
    keys.add(key);
  }

  return members.filter(Boolean).join(",") || undefined;
}

function isTraceStateMember(member: string) {
  const separator = member.indexOf("=");
  if (separator <= 0 || separator !== member.lastIndexOf("=")) return false;
  const key = member.slice(0, separator);
  const value = member.slice(separator + 1);
  return isTraceStateKey(key) && traceStateValuePattern.test(value) &&
    !value.endsWith(" ");
}

function isTraceStateKey(key: string) {
  if (traceStateSimpleKeyPattern.test(key)) return true;
  const separator = key.indexOf("@");
  if (separator < 1 || separator !== key.lastIndexOf("@")) return false;
  return traceStateTenantKeyPattern.test(key.slice(0, separator)) &&
    traceStateSystemKeyPattern.test(key.slice(separator + 1));
}
