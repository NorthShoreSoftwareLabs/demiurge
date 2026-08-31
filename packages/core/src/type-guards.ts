/**
 * Narrows a value to a keyed object, rejecting arrays.
 *
 * This is the guard for parsing a value that is supposed to be a record: a
 * decoded session payload, a policy object, a cache key map. An array is a
 * `typeof "object"` too, so a caller that reads named properties needs the
 * array rejected rather than narrowed to a record whose keys are all
 * missing. Use this one unless a caller genuinely accepts either shape.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Narrows a value to any non-null object, arrays included.
 *
 * This is the weaker guard, for the callers that only need to know a value is
 * not a primitive before probing it further. Reach for {@link isPlainObject}
 * instead whenever an array reaching the narrowed branch would be a defect.
 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
