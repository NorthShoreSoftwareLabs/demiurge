export type ObservabilityValue =
  | boolean
  | null
  | number
  | string
  | readonly ObservabilityValue[]
  | { readonly [key: string]: ObservabilityValue };

export type RequestSignal = {
  duration?: number;
  method: string;
  pathname: string;
  status?: number;
  attributes?: Readonly<Record<string, ObservabilityValue>>;
};

export type ServerStartSignal = {
  adapter?: string;
  attributes?: Readonly<Record<string, ObservabilityValue>>;
  timestamp?: number;
};

export type TraceSignal = {
  attributes?: Readonly<Record<string, ObservabilityValue>>;
  duration?: number;
  name: string;
  status?: "error" | "ok" | "unset";
  traceId?: string;
};

export type WebVitalName = "CLS" | "FCP" | "FID" | "INP" | "LCP" | "TTFB";

export type WebVitalSignal = {
  id?: string;
  name: WebVitalName;
  navigationType?: string;
  rating?: "good" | "needs-improvement" | "poor";
  value: number;
  attributes?: Readonly<Record<string, ObservabilityValue>>;
};

export type InstrumentationEvent =
  | { kind: "request"; signal: RequestSignal }
  | { kind: "server-start"; signal: ServerStartSignal }
  | { kind: "trace"; signal: TraceSignal }
  | { kind: "web-vital"; signal: WebVitalSignal };

export type InstrumentationHandler<T> = (signal: T) => void | Promise<void>;

export type InstrumentationOptions = {
  onEvent?: InstrumentationHandler<InstrumentationEvent>;
  request?: InstrumentationHandler<RequestSignal>;
  serverStart?: InstrumentationHandler<ServerStartSignal>;
  trace?: InstrumentationHandler<TraceSignal>;
  webVitals?: InstrumentationHandler<WebVitalSignal>;
};

export type Instrumentation = {
  request: (signal: RequestSignal) => Promise<void>;
  serverStart: (signal?: ServerStartSignal) => Promise<void>;
  trace: (signal: TraceSignal) => Promise<void>;
  reportWebVitals: (signal: WebVitalSignal) => Promise<void>;
};

export function defineInstrumentation(
  options: InstrumentationOptions = {},
): Instrumentation {
  return {
    async request(signal) {
      await dispatch({ kind: "request", signal }, options);
    },
    async serverStart(signal = {}) {
      await dispatch({ kind: "server-start", signal }, options);
    },
    async trace(signal) {
      await dispatch({ kind: "trace", signal }, options);
    },
    async reportWebVitals(signal) {
      await dispatch({ kind: "web-vital", signal }, options);
    },
  };
}

async function dispatch(
  event: InstrumentationEvent,
  options: InstrumentationOptions,
) {
  await options.onEvent?.(event);

  if (event.kind === "request") {
    await options.request?.(event.signal);
  } else if (event.kind === "server-start") {
    await options.serverStart?.(event.signal);
  } else if (event.kind === "trace") {
    await options.trace?.(event.signal);
  } else {
    await options.webVitals?.(event.signal);
  }
}
