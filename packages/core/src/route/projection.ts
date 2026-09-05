import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { MaybePromise } from "./types";

/**
 * A typed function that selects the browser value from a server value.
 *
 * The function runs on the server after the page data function returns. The
 * framework serializes the result of this function, and it does not serialize
 * the value that the page data function returned.
 */
export type DataProjectionFunction<TData, TPublic> = (
  data: TData,
) => MaybePromise<TPublic>;

/**
 * A projection declaration.
 *
 * The declaration is a typed function or a Standard Schema. A Standard Schema
 * keeps interoperability with an external validation library.
 */
export type DataProjection<TData, TPublic> =
  | DataProjectionFunction<TData, TPublic>
  | StandardSchemaV1<TData, TPublic>;

/**
 * The disclosure declaration of a route that returns data.
 *
 * A route declares a projection with `project`, or it declares that the whole
 * result is public with `publicData: true`. A route that returns no data
 * declares nothing.
 */
export type DataDisclosure<TData, TPublic> =
  | { project: DataProjection<TData, TPublic>; publicData?: never }
  | { project?: never; publicData: true };

/**
 * The error that the framework reports for a disclosure failure.
 *
 * The message names the route and the field. The message does not contain the
 * value.
 */
export class DataDisclosureError extends Error {
  readonly field?: string;
  readonly route: string;

  constructor(message: string, route: string, field?: string) {
    super(message);
    this.name = "DataDisclosureError";
    this.route = route;
    this.field = field;
  }
}

/**
 * The declaration that the framework reads at request time.
 *
 * The `project` field holds a projection function or a Standard Schema. The
 * runtime checks the shape, so the type stays free of a variance constraint.
 */
export type DisclosureDeclaration = {
  project?: unknown;
  publicData?: true;
};

export function declaresDisclosure(declaration: DisclosureDeclaration) {
  return declaration.project !== undefined || declaration.publicData === true;
}

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== "object" || value === null) return false;
  // TYPE-EVIDENCE: the checks above prove that the value is an object. The cast reads one optional property from it.
  const standard = (value as { "~standard"?: unknown })["~standard"];
  if (typeof standard !== "object" || standard === null) return false;
  // TYPE-EVIDENCE: the check above proves that the property is an object. The cast reads one optional property from it.
  return typeof (standard as { validate?: unknown }).validate === "function";
}

/**
 * Applies the disclosure declaration of a route and returns the browser value.
 *
 * The framework calls this function one time for each request. The initial
 * document, the hydration payload, and the navigation response all use the
 * returned value.
 */
export async function projectRouteData(options: {
  data: unknown;
  declaration: DisclosureDeclaration;
  kind?: "page" | "mutation";
  route: string;
}): Promise<unknown> {
  const { data, declaration, route } = options;
  const kind = options.kind ?? "page";

  if (!declaresDisclosure(declaration)) {
    throw new DataDisclosureError(missingDeclarationMessage(kind, route), route);
  }

  const projected = declaration.project === undefined
    ? data
    : await applyProjection(declaration.project, data, route);

  assertSerializableValue(projected, route);
  return projected;
}

async function applyProjection(
  projection: unknown,
  data: unknown,
  route: string,
) {
  if (typeof projection === "function") {
    // TYPE-EVIDENCE: a projection function takes the server value and returns the browser value. The cast labels the checked function with that shape.
    return await (projection as DataProjectionFunction<unknown, unknown>)(data);
  }

  if (!isStandardSchema(projection)) {
    throw new DataDisclosureError(
      `Route ${route} declares a projection that is not a function and not a Standard Schema.`,
      route,
    );
  }

  const result = await projection["~standard"].validate(data);
  if (result.issues) {
    const field = describeSchemaPath(result.issues[0]?.path);
    throw new DataDisclosureError(
      `Route ${route} could not project the field ${field}. The output schema refused the value.`,
      route,
      field,
    );
  }
  return result.value;
}

function describeSchemaPath(path: StandardSchemaV1.Issue["path"]) {
  if (!path || path.length === 0) return "<root>";
  return path
    .map((segment) =>
      typeof segment === "object" ? String(segment.key) : String(segment)
    )
    .join(".");
}

function missingDeclarationMessage(kind: "page" | "mutation", route: string) {
  if (kind === "mutation") {
    return `Route ${route} returns mutation data and declares no browser disclosure. Add project to select the fields, or add publicData: true when the whole result is public.`;
  }
  return `Route ${route} returns page data and declares no browser disclosure. Add project to select the fields, or add publicData: true when the whole result is public.`;
}

/**
 * Proves that the framework can serialize a browser value.
 *
 * The report names the route and the field. The report does not contain the
 * value.
 */
export function assertSerializableValue(
  value: unknown,
  route: string,
  path: readonly string[] = [],
  seen = new Set<object>(),
): void {
  if (value === undefined && path.length === 0) return;
  if (value === null) return;

  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return;
  if (kind === "number") {
    if (Number.isFinite(value)) return;
    throw unserializableValue(route, path);
  }
  if (kind !== "object") throw unserializableValue(route, path);

  // TYPE-EVIDENCE: the typeof check above proves that the value is an object.
  const objectValue = value as object;
  if (seen.has(objectValue)) throw unserializableValue(route, path);
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

  const prototype = Object.getPrototypeOf(objectValue);
  if (prototype !== Object.prototype && prototype !== null) {
    throw unserializableValue(route, path);
  }

  for (const key of Reflect.ownKeys(objectValue)) {
    if (typeof key !== "string") throw unserializableValue(route, [...path, "<symbol>"]);
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key);
    if (descriptor?.get) throw unserializableValue(route, [...path, key]);
    assertSerializableValue(descriptor?.value, route, [...path, key], seen);
  }

  seen.delete(objectValue);
}

function unserializableValue(route: string, path: readonly string[]) {
  const field = path.length === 0 ? "<root>" : path.join(".");
  return new DataDisclosureError(
    `Route ${route} could not serialize the field ${field} for the browser. Change the projection to send a JSON value.`,
    route,
    field,
  );
}
