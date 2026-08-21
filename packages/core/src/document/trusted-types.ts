// The framework writes two script URLs of its own. The `idle` strategy sets
// `src` on a script element, and the `worker` strategy calls the `Worker`
// constructor. Trusted Types guards both. The framework owns a named
// `demiurge` policy for them, so an application never has to name a framework
// sink in its own policy list.
export const FRAMEWORK_TRUSTED_TYPES_POLICY = "demiurge";

// A browser accepts a TrustedScriptURL where the DOM declaration says
// `string`. The DOM library types do not describe Trusted Types, so this
// module keeps the value typed as a string and documents the difference.
type FrameworkScriptUrlPolicy = {
  createScriptURL: (value: string) => string;
};

type TrustedTypesApi = {
  createPolicy: (
    name: string,
    rules: { createScriptURL: (value: string) => string },
  ) => FrameworkScriptUrlPolicy;
};

// A window may create a policy name one time only, so the result is cached per
// window. `null` records a window that cannot give the framework a policy.
const frameworkPolicies = new WeakMap<object, FrameworkScriptUrlPolicy | null>();

/**
 * Returns a value the framework can assign to a Trusted Types script sink.
 *
 * If the browser supports Trusted Types, the value is a TrustedScriptURL from
 * the framework-owned `demiurge` policy. If the browser does not support
 * Trusted Types, the value is the original string.
 */
export function createFrameworkScriptUrl(
  view: (Window & typeof globalThis) | null | undefined,
  url: string,
) {
  return resolveFrameworkPolicy(view)?.createScriptURL(url) ?? url;
}

function resolveFrameworkPolicy(
  view: (Window & typeof globalThis) | null | undefined,
) {
  if (!view) {
    return null;
  }

  const cached = frameworkPolicies.get(view);

  if (cached !== undefined) {
    return cached;
  }

  const policy = createFrameworkPolicy(view);
  frameworkPolicies.set(view, policy);

  return policy;
}

function createFrameworkPolicy(view: object) {
  // SAFETY: the view is a browser global that may expose the Trusted Types API. The cast adds that optional property for a runtime check.
  const trustedTypes = (view as { trustedTypes?: TrustedTypesApi }).trustedTypes;

  if (!trustedTypes || typeof trustedTypes.createPolicy !== "function") {
    return null;
  }

  try {
    return trustedTypes.createPolicy(FRAMEWORK_TRUSTED_TYPES_POLICY, {
      // The framework passes only a URL that the server rendered into its own
      // placeholder attribute. `script-src` and `worker-src` still govern that
      // URL, so this policy adds a type without widening the source rules.
      createScriptURL: (value: string) => value,
    });
  } catch (error) {
    // The document policy refuses the name. Another caller may have created
    // it. Report the refusal. Fall back to the raw string. An enforcing
    // document then blocks that string. The developer can see the block.
    console.error(
      `Demiurge could not create the ${JSON.stringify(FRAMEWORK_TRUSTED_TYPES_POLICY)} Trusted Types policy. Add ${JSON.stringify(FRAMEWORK_TRUSTED_TYPES_POLICY)} to the document trusted-types directive.`,
      error,
    );

    return null;
  }
}
