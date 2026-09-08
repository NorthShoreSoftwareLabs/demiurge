/**
 * The error that the framework reports for a browser payload that it cannot
 * serialize.
 *
 * The message names the route and the field path. The message does not
 * contain the value.
 */
export class RouteSerializationError extends Error {
  readonly field?: string;
  readonly route: string;

  constructor(message: string, route: string, field?: string) {
    super(message);
    this.name = "RouteSerializationError";
    this.route = route;
    this.field = field;
  }
}

/**
 * Proves that the framework can serialize a page route browser payload.
 *
 * The return value of a page `data` function is the browser payload. This
 * check names the value that `JSON.stringify` cannot represent, so it
 * matches exactly the failures that already occur: a circular reference and
 * a `bigint` value. It does not add a check for a value that
 * `JSON.stringify` already accepts or silently drops, such as `undefined`,
 * a function, a symbol key, or a non-finite number.
 */
export function assertSerializableValue(
  value: unknown,
  route: string,
  path: readonly string[] = [],
  seen = new Set<object>(),
): void {
  if (value === null) return;

  const kind = typeof value;

  if (kind === "bigint") {
    throw unserializableValue(route, path, "a bigint value");
  }

  if (kind !== "object") return;

  // TYPE-EVIDENCE: the typeof check above proves that the value is an object.
  const objectValue = value as object;

  if (seen.has(objectValue)) {
    throw unserializableValue(route, path, "a circular reference");
  }

  seen.add(objectValue);

  if (Array.isArray(objectValue)) {
    for (let index = 0; index < objectValue.length; index += 1) {
      assertSerializableValue(
        objectValue[index],
        route,
        [...path, String(index)],
        seen,
      );
    }
    seen.delete(objectValue);
    return;
  }

  for (const key of Object.keys(objectValue)) {
    // TYPE-EVIDENCE: Object.keys returns the own enumerable string keys of objectValue. The cast reads one property that a checked key names.
    assertSerializableValue(
      (objectValue as Record<string, unknown>)[key],
      route,
      [...path, key],
      seen,
    );
  }

  seen.delete(objectValue);
}

function unserializableValue(
  route: string,
  path: readonly string[],
  reason: string,
) {
  const field = path.length === 0 ? "<root>" : path.join(".");
  return new RouteSerializationError(
    `Route ${route} could not serialize the field ${field} for the browser. The value contains ${reason}.`,
    route,
    field,
  );
}
