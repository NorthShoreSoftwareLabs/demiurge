import type { VercelNodeDeployment } from "../vercel/config";
import { validateVercelNodeDeployment } from "../vercel/config";
import { generateVercelNodeOutput } from "../vercel/build";
import type { StaticFileHeaderPatternRule } from "../static";

export type ServerDeploymentProvider = VercelNodeDeployment;

export type GenerateServerProviderOutputOptions = {
  clientDir: string;
  deployment: ServerDeploymentProvider;
  projectRoot: string;
  serverDir: string;
  staticFileHeaders?: readonly StaticFileHeaderPatternRule[];
};

export function validateServerDeploymentProvider(
  value: unknown,
): asserts value is ServerDeploymentProvider {
  if (!value || typeof value !== "object" || !("adapter" in value)) {
    throw new Error(
      "Demiurge deployment.server.provider requires a supported adapter.",
    );
  }

  // TYPE-EVIDENCE: the object and adapter checks above permit this discriminator read.
  const deployment = value as { adapter?: unknown };
  if (deployment.adapter === "vercel-node") {
    // TYPE-EVIDENCE: the adapter discriminator selects the Vercel validator, which checks every remaining field.
    validateVercelNodeDeployment(value as VercelNodeDeployment);
    return;
  }

  throw new Error(
    `Demiurge deployment.server.provider adapter ${JSON.stringify(deployment.adapter)} is not supported.`,
  );
}

export function generateServerProviderOutput(
  options: GenerateServerProviderOutputOptions,
) {
  validateServerDeploymentProvider(options.deployment);

  switch (options.deployment.adapter) {
    case "vercel-node":
      if (options.staticFileHeaders?.length) {
        throw new Error(
          "Vercel Node deployment does not support security.staticFileHeaders. Remove the rules or use a deployment that serves the browser output directly.",
        );
      }
      return generateVercelNodeOutput(options);
  }
}
