export const RUNTIME_INSTRUMENTATION_CONVENTION_VERSION = 1 as const;

export type RuntimeSpanOperation =
  | "demiurge.request"
  | "demiurge.middleware"
  | "demiurge.route.data"
  | "demiurge.route.mutation"
  | "demiurge.render"
  | "demiurge.cache"
  | "demiurge.store"
  | "demiurge.background"
  | "demiurge.adapter.start"
  | "demiurge.adapter.shutdown";

export type RuntimeSpanKind = "client" | "internal" | "server";

export type RuntimeSpanStatus = "error" | "ok" | "unset";

export type RuntimeSpanScalar = boolean | number | string;

export type RuntimeSpanAttributeValue =
  | RuntimeSpanScalar
  | readonly RuntimeSpanScalar[];

export type RuntimeSpanAttributes = Readonly<
  Record<string, RuntimeSpanAttributeValue>
>;

export type RuntimeSpanContext = Readonly<Record<string, unknown>>;

export type RuntimeSpanLink = {
  attributes?: RuntimeSpanAttributes;
  context: RuntimeSpanContext;
};

export type RuntimeSpanStartOptions = {
  attributes?: RuntimeSpanAttributes;
  kind: RuntimeSpanKind;
  links?: readonly RuntimeSpanLink[];
  name?: string;
  operation: RuntimeSpanOperation;
  parent?: RuntimeSpanContext;
};

export type RuntimeSpanEventOptions = {
  attributes?: RuntimeSpanAttributes;
};

export type RuntimeInstrumentationFailure =
  | "add-event"
  | "end"
  | "invalid-attribute"
  | "set-attribute"
  | "set-name"
  | "set-status"
  | "start-span";

export type RuntimeInstrumentationError = {
  failure: RuntimeInstrumentationFailure;
  operation: RuntimeSpanOperation;
};

export type RuntimeSpanImplementation = {
  readonly context: RuntimeSpanContext;
  addEvent?: (
    name: string,
    options?: RuntimeSpanEventOptions,
  ) => void | Promise<void>;
  end: () => void | Promise<void>;
  setAttribute?: (
    name: string,
    value: RuntimeSpanAttributeValue,
  ) => void | Promise<void>;
  setName?: (name: string) => void | Promise<void>;
  setStatus?: (status: RuntimeSpanStatus) => void | Promise<void>;
};

export type RuntimeSpan = {
  readonly context: RuntimeSpanContext;
  addEvent: (name: string, options?: RuntimeSpanEventOptions) => void;
  end: () => void;
  setAttribute: (name: string, value: RuntimeSpanAttributeValue) => void;
  setName: (name: string) => void;
  setStatus: (status: RuntimeSpanStatus) => void;
};

export type RuntimeInstrumentationOptions = {
  onError?: (
    error: RuntimeInstrumentationError,
  ) => void | Promise<void>;
  startSpan?: (
    options: RuntimeSpanStartOptions,
  ) => RuntimeSpanImplementation | undefined;
};

export type RuntimeInstrumentation = {
  startSpan: (options: RuntimeSpanStartOptions) => RuntimeSpan | undefined;
};

const frameworkAttributeNames = new Set([
  "demiurge.operation.outcome",
  "demiurge.render.mode",
  "demiurge.cache.operation",
  "demiurge.cache.outcome",
  "demiurge.cache.namespace",
  "demiurge.store.operation",
  "demiurge.adapter.name",
  "demiurge.runtime.kind",
  "demiurge.response.body_observation",
  "error.type",
  "http.request.method",
  "http.response.status_code",
  "http.route",
  "url.scheme",
]);

const applicationAttributeLimit = 32;
const attributeNameLimit = 128;
const attributeStringLimit = 1_024;
const attributeArrayLimit = 32;

export function defineRuntimeInstrumentation(
  options: RuntimeInstrumentationOptions = {},
): RuntimeInstrumentation {
  let reportingError = false;

  const report = (
    failure: RuntimeInstrumentationFailure,
    operation: RuntimeSpanOperation,
  ) => {
    if (!options.onError || reportingError) return;

    reportingError = true;
    try {
      const result = options.onError({ failure, operation });
      void Promise.resolve(result).catch(() => {});
    } catch {
      // The error callback is the final failure boundary.
    } finally {
      reportingError = false;
    }
  };

  return {
    startSpan(startOptions) {
      if (!options.startSpan) return undefined;

      const applicationAttributes = new Set<string>();
      const attributes = filterAttributes(
        startOptions.attributes,
        applicationAttributes,
        () => report("invalid-attribute", startOptions.operation),
      );
      let implementation: RuntimeSpanImplementation | undefined;

      try {
        implementation = options.startSpan({
          ...startOptions,
          attributes,
          links: filterLinks(
            startOptions.links,
            () => report("invalid-attribute", startOptions.operation),
          ),
        });
      } catch {
        report("start-span", startOptions.operation);
        return undefined;
      }

      if (!implementation) return undefined;
      let context: RuntimeSpanContext;

      try {
        context = implementation.context;
      } catch {
        report("start-span", startOptions.operation);
        return undefined;
      }

      const call = (
        failure: RuntimeInstrumentationFailure,
        action: (() => void | Promise<void>) | undefined,
      ) => {
        if (!action) return;

        try {
          const result = action();
          void Promise.resolve(result).catch(() => {
            report(failure, startOptions.operation);
          });
        } catch {
          report(failure, startOptions.operation);
        }
      };

      return {
        context,
        addEvent(name, eventOptions) {
          const eventAttributes = filterAttributes(
            eventOptions?.attributes,
            applicationAttributes,
            () => report("invalid-attribute", startOptions.operation),
          );
          call("add-event", implementation.addEvent
            ? () => implementation.addEvent?.(name, { attributes: eventAttributes })
            : undefined);
        },
        end() {
          call("end", () => implementation.end());
        },
        setAttribute(name, value) {
          if (!acceptAttribute(name, value, applicationAttributes)) {
            report("invalid-attribute", startOptions.operation);
            return;
          }
          call("set-attribute", implementation.setAttribute
            ? () => implementation.setAttribute?.(name, value)
            : undefined);
        },
        setName(name) {
          call("set-name", implementation.setName
            ? () => implementation.setName?.(name)
            : undefined);
        },
        setStatus(status) {
          call("set-status", implementation.setStatus
            ? () => implementation.setStatus?.(status)
            : undefined);
        },
      };
    },
  };
}

export function startRuntimeSpan(
  instrumentation: RuntimeInstrumentation | undefined,
  options: RuntimeSpanStartOptions,
) {
  if (!instrumentation) return undefined;

  try {
    return instrumentation.startSpan(options);
  } catch {
    return undefined;
  }
}

function filterLinks(
  links: readonly RuntimeSpanLink[] | undefined,
  onInvalid: () => void,
) {
  return links?.map((link) => ({
    ...link,
    attributes: filterAttributes(link.attributes, new Set(), onInvalid),
  }));
}

function filterAttributes(
  attributes: RuntimeSpanAttributes | undefined,
  applicationAttributes: Set<string>,
  onInvalid: () => void,
) {
  if (!attributes) return undefined;

  const accepted: Record<string, RuntimeSpanAttributeValue> = {};
  for (const [name, value] of Object.entries(attributes)) {
    if (acceptAttribute(name, value, applicationAttributes)) {
      accepted[name] = value;
    } else {
      onInvalid();
    }
  }
  return accepted;
}

function acceptAttribute(
  name: string,
  value: RuntimeSpanAttributeValue,
  applicationAttributes: Set<string>,
) {
  if (!validAttributeValue(value)) return false;
  if (frameworkAttributeNames.has(name)) return true;
  if (!name.startsWith("app.") || codePointLength(name) > attributeNameLimit) {
    return false;
  }
  if (!validApplicationValue(value)) return false;
  if (applicationAttributes.has(name)) return true;
  if (applicationAttributes.size >= applicationAttributeLimit) return false;
  applicationAttributes.add(name);
  return true;
}

function validAttributeValue(value: RuntimeSpanAttributeValue) {
  if (!isScalarArray(value)) return validScalar(value);
  if (value.length === 0) return true;

  const type = typeof value[0];
  return value.every((item) => typeof item === type && validScalar(item));
}

function validApplicationValue(value: RuntimeSpanAttributeValue) {
  const values: readonly RuntimeSpanScalar[] = isScalarArray(value)
    ? value
    : [value];
  if (values.length > attributeArrayLimit) return false;
  return values.every((item) =>
    typeof item !== "string" || codePointLength(item) <= attributeStringLimit
  );
}

function isScalarArray(
  value: RuntimeSpanAttributeValue,
): value is readonly RuntimeSpanScalar[] {
  return Array.isArray(value);
}

function validScalar(value: RuntimeSpanScalar) {
  return typeof value !== "number" || Number.isFinite(value);
}

function codePointLength(value: string) {
  return [...value].length;
}
