import {
  assertAdapterCapabilities,
  type Adapter,
} from "../adapter";
import {
  createRouteManifest,
  isAttachedFileForRoute,
} from "../router";
import type {
  HttpMethod,
  ResponseCapability,
  RouteCapability,
  RouteModule,
} from "../route";
import { validateCorsPolicy } from "./cors";
import {
  createSecurityHeaders,
  mergeRoutePolicies,
  securityPolicyRequiresNonce,
} from "./policy";
import { validateRateLimitPolicy } from "./rate-limit";

export type RouteModuleVerificationOptions = {
  adapter?: Adapter;
};

const httpMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const satisfies readonly HttpMethod[];

export function validateRouteModules(
  modules: Readonly<Record<string, RouteModule>>,
  options: RouteModuleVerificationOptions = {},
) {
  for (const [file, routeModule] of Object.entries(modules)) {
    validateModulePolicy(file, routeModule);

    for (const method of httpMethods) {
      const capability = routeModule[method];

      if (!capability || capability.kind === "page") {
        continue;
      }

      validateResponseCapability(file, method, capability, routeModule);
    }
  }

  validatePagePolicies(modules, options.adapter);
}

function validateModulePolicy(file: string, routeModule: RouteModule) {
  const rateLimit = routeModule.policy?.security?.rateLimit;

  if (rateLimit) {
    validateWithContext(file, "policy", "rate limit", () => {
      validateRateLimitPolicy(rateLimit);
    });
  }

}

function validateResponseCapability(
  file: string,
  method: HttpMethod,
  capability: ResponseCapability,
  routeModule: RouteModule,
) {
  if (capability.cors) {
    validateWithContext(file, method, "CORS", () => {
      validateCorsPolicy(capability.cors!);
      validateCorsMethods(file, method, capability.cors!.methods, routeModule);
    });
  }

  if (capability.security?.rateLimit) {
    validateWithContext(file, method, "rate limit", () => {
      validateRateLimitPolicy(capability.security!.rateLimit!);
    });
  }
}

function validateCorsMethods(
  file: string,
  exportName: HttpMethod,
  methods: readonly HttpMethod[] | undefined,
  routeModule: RouteModule,
) {
  if (!methods) {
    return;
  }

  for (const method of methods) {
    if (responseCapabilityForMethod(routeModule, method)) {
      continue;
    }

    throw new Error(
      `Route ${JSON.stringify(file)} export ${exportName} allows CORS method ${method}, but the route does not export that response capability.`,
    );
  }
}

function responseCapabilityForMethod(
  routeModule: RouteModule,
  method: HttpMethod,
): ResponseCapability | undefined {
  const capability = method === "HEAD"
    ? routeModule.HEAD ?? routeModule.GET
    : routeModule[method];

  return isResponseCapability(capability) ? capability : undefined;
}

function isResponseCapability(
  capability: RouteCapability | undefined,
): capability is ResponseCapability {
  return Boolean(capability && capability.kind !== "page");
}

function validatePagePolicies(
  modules: Readonly<Record<string, RouteModule>>,
  adapter: Adapter | undefined,
) {
  const manifest = createRouteManifest(
    Object.fromEntries(
      Object.entries(modules).map(([file, routeModule]) => [
        file,
        async () => routeModule,
      ]),
    ),
  );

  for (const route of manifest.routes) {
    const routeModule = modules[route.file];
    const page = routeModule?.GET;

    if (!page || page.kind !== "page") {
      continue;
    }

    const effectivePolicy = mergeRoutePolicies(
      ...manifest.policies
        .filter((policy) =>
          isAttachedFileForRoute(policy.fileSegments, route.fileSegments)
        )
        .map((policy) => modules[policy.file]?.policy),
      routeModule.policy,
    );

    validateEffectiveDocument(route.file, "GET", effectivePolicy, adapter);
  }

  const fallbacks = [
    ...manifest.fallbacks.error,
    ...manifest.fallbacks.loading,
    ...manifest.fallbacks.notFound,
  ];

  for (const fallback of fallbacks) {
    const effectivePolicy = mergeRoutePolicies(
      ...manifest.policies
        .filter((policy) =>
          isAttachedFileForRoute(policy.fileSegments, fallback.fileSegments)
        )
        .map((policy) => modules[policy.file]?.policy),
      modules[fallback.file]?.policy,
    );

    validateEffectiveDocument(
      fallback.file,
      "policy",
      effectivePolicy,
      adapter,
    );
  }
}

function validateEffectiveDocument(
  file: string,
  exportName: HttpMethod | "policy",
  effectivePolicy: ReturnType<typeof mergeRoutePolicies>,
  adapter: Adapter | undefined,
) {
  validateWithContext(file, exportName, "effective document", () => {
    createSecurityHeaders(effectivePolicy.document ?? {}, {
      nonce: "startup-verification-nonce",
    });
  });

  if (!adapter || !securityPolicyRequiresNonce(effectivePolicy.document)) {
    return;
  }

  validateWithContext(file, exportName, "effective CSP", () => {
    assertAdapterCapabilities(adapter, ["nonceInjection"]);
  });
}

function validateWithContext(
  file: string,
  exportName: HttpMethod | "policy",
  policyName: string,
  validate: () => void,
) {
  try {
    validate();
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith(`Route ${JSON.stringify(file)} export `)
    ) {
      throw error;
    }

    const message = error instanceof Error
      ? error.message
      : `${policyName} validation failed.`;

    throw new Error(
      `Route ${JSON.stringify(file)} export ${exportName} has an invalid ${policyName} policy. ${message}`,
      { cause: error },
    );
  }
}
