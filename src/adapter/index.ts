export type AdapterCapability =
  | "crossOriginIsolationHeaders"
  | "nonceInjection"
  | "sharedCache"
  | "staticOutput"
  | "streaming"
  | "webSocket"
  | "webTransport";

export type AdapterCapabilityMap = Record<AdapterCapability, boolean>;

export type Adapter = {
  capabilities: AdapterCapabilityMap;
  name: string;
};

export type AdapterDefinition = {
  capabilities?: Partial<AdapterCapabilityMap>;
  name: string;
};

export type AdapterCapabilityCheck = {
  adapter: string;
  missing: AdapterCapability[];
  ok: boolean;
  required: AdapterCapability[];
};

const defaultCapabilities = {
  crossOriginIsolationHeaders: false,
  nonceInjection: false,
  sharedCache: false,
  staticOutput: false,
  streaming: false,
  webSocket: false,
  webTransport: false,
} satisfies AdapterCapabilityMap;

export function defineAdapter(definition: AdapterDefinition): Adapter {
  return {
    capabilities: {
      ...defaultCapabilities,
      ...definition.capabilities,
    },
    name: definition.name,
  };
}

export function checkAdapterCapabilities(
  adapter: Adapter,
  required: readonly AdapterCapability[],
): AdapterCapabilityCheck {
  const uniqueRequired = [...new Set(required)];
  const missing = uniqueRequired.filter(
    (capability) => !adapter.capabilities[capability],
  );

  return {
    adapter: adapter.name,
    missing,
    ok: missing.length === 0,
    required: uniqueRequired,
  };
}

export function assertAdapterCapabilities(
  adapter: Adapter,
  required: readonly AdapterCapability[],
) {
  const check = checkAdapterCapabilities(adapter, required);

  if (!check.ok) {
    throw new Error(
      `Adapter "${adapter.name}" does not support required capabilities: ${check.missing.join(", ")}.`,
    );
  }

  return check;
}
