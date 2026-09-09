import { isPlainObject } from "../type-guards";
import type {
  InspectionRedaction,
  InspectionRedactionReason,
} from "./types";

/**
 * The text that replaces a removed value. A reader sees this marker in place
 * of the value, and the `redactions` section names the field and the reason.
 */
export const REDACTED_VALUE = "[redacted]";

export type InspectionSerializeOptions = {
  /**
   * The names of the environment variables that an `env.secret(...)`
   * declaration produced.
   */
  secretEnvKeys?: Iterable<string>;
  /** The indentation of the JSON output. The default value is 2. */
  space?: number;
};

export type InspectionRedactionResult = {
  /** The values that this module removed, sorted by path. */
  redactions: InspectionRedaction[];
  /** The report without the removed values. */
  value: unknown;
};

// ADR 0019 gives the framework one place that removes a secret value. Every
// report reaches its output through this module, so no other code repeats the
// rule. A field name identifies a cookie or a session, and the environment
// schema identifies a secret variable.
const cookieFieldNames = new Set([
  "cookie",
  "cookies",
  "setcookie",
  "setcookies",
]);
const sessionFieldNames = new Set([
  "session",
  "sessiondata",
  "sessionrecord",
  "sessions",
]);
// A cookie declaration holds its payload in one field. The name and the other
// attributes stay in the report, because they carry no secret.
const cookieValueFieldNames = new Set(["value"]);
// A session record holds the application data and the identifier of the
// session. The expiry timestamps stay in the report.
const sessionValueFieldNames = new Set(["data", "id"]);

type WalkContext = {
  inCookie: boolean;
  inSession: boolean;
  secretEnvKeys: ReadonlySet<string>;
};

/**
 * Serializes a report and removes each secret value. This function is the one
 * choke point of ADR 0019.
 *
 * The function writes the collected redactions into the `redactions` field of
 * the report when the report declares that field.
 */
export function serializeInspectionReport(
  report: unknown,
  options: InspectionSerializeOptions = {},
): string {
  const result = redactSecrets(report, options);
  const value = attachRedactions(result);

  return JSON.stringify(value, undefined, options.space ?? 2);
}

/**
 * Removes each secret value from a report and returns the removed names. The
 * function does not change the report that the caller supplied.
 */
export function redactSecrets(
  report: unknown,
  options: InspectionSerializeOptions = {},
): InspectionRedactionResult {
  const redactions: InspectionRedaction[] = [];
  const context: WalkContext = {
    inCookie: false,
    inSession: false,
    secretEnvKeys: new Set(options.secretEnvKeys ?? []),
  };
  const value = walk(report, "", context, redactions);

  redactions.sort((left, right) => left.path.localeCompare(right.path));

  return { redactions, value };
}

function attachRedactions(result: InspectionRedactionResult) {
  if (!isRecord(result.value)) return result.value;
  if (!Array.isArray(result.value.redactions)) return result.value;

  return { ...result.value, redactions: result.redactions };
}

function walk(
  value: unknown,
  path: string,
  context: WalkContext,
  redactions: InspectionRedaction[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      walk(item, `${path}[${index}]`, context, redactions)
    );
  }

  if (!isRecord(value)) return value;

  const scope: WalkContext = isSessionRecord(value)
    ? { ...context, inSession: true }
    : context;
  const result: Record<string, unknown> = {};

  for (const [name, item] of Object.entries(value)) {
    const itemPath = path ? `${path}.${name}` : name;
    const reason = classifyField(name, item, scope);

    if (reason) {
      redactions.push({ name, path: itemPath, reason });
      result[name] = REDACTED_VALUE;
      continue;
    }

    result[name] = walk(item, itemPath, descend(name, scope), redactions);
  }

  return result;
}

function classifyField(
  name: string,
  value: unknown,
  context: WalkContext,
): InspectionRedactionReason | undefined {
  if (context.secretEnvKeys.has(name)) return "environment-secret";

  const normalized = normalizeFieldName(name);

  if (context.inCookie && cookieValueFieldNames.has(normalized)) {
    return "cookie-value";
  }

  if (context.inSession && sessionValueFieldNames.has(normalized)) {
    return "session-record";
  }

  if (typeof value !== "string") return undefined;
  if (cookieFieldNames.has(normalized)) return "cookie-value";
  if (sessionFieldNames.has(normalized)) return "session-record";

  return undefined;
}

function descend(name: string, context: WalkContext): WalkContext {
  const normalized = normalizeFieldName(name);

  if (cookieFieldNames.has(normalized)) return { ...context, inCookie: true };
  if (sessionFieldNames.has(normalized)) return { ...context, inSession: true };

  return context;
}

// A header name uses a hyphen and a property name uses camel case. One
// normalized form matches both spellings of the same field.
function normalizeFieldName(name: string) {
  return name.toLowerCase().replaceAll("-", "").replaceAll("_", "");
}

// A class instance such as `Date` carries no own enumerable field, so a walk
// of its entries would replace it with an empty object. The walker returns it
// without a change and lets `JSON.stringify` serialize it.
function isRecord(value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

// A session record reaches a report through a field that carries another name.
// The shape of `SessionRecord` identifies it without that name.
function isSessionRecord(value: Record<string, unknown>) {
  return typeof value.id === "string" &&
    typeof value.createdAt === "number" &&
    typeof value.expiresAt === "number" &&
    typeof value.version === "number" &&
    "data" in value;
}
