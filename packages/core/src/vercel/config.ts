export type VercelNodeRuntime = "nodejs22.x";

export type VercelNodeOptions = {
  maxDuration?: number;
  regions?: readonly string[];
  runtime?: VercelNodeRuntime;
};

export type VercelNodeDeployment = {
  adapter: "vercel-node";
  maxDuration?: number;
  regions?: string[];
  runtime: VercelNodeRuntime;
};

export function vercelNode(
  options: VercelNodeOptions = {},
): VercelNodeDeployment {
  const deployment: VercelNodeDeployment = {
    adapter: "vercel-node",
    runtime: options.runtime ?? "nodejs22.x",
    ...(options.maxDuration === undefined
      ? {}
      : { maxDuration: options.maxDuration }),
    ...(options.regions === undefined
      ? {}
      : { regions: [...options.regions] }),
  };

  validateVercelNodeDeployment(deployment);
  return deployment;
}

export function validateVercelNodeDeployment(
  deployment: VercelNodeDeployment,
) {
  if (
    deployment.adapter !== "vercel-node" ||
    deployment.runtime !== "nodejs22.x"
  ) {
    throw new Error("The Vercel Node deployment configuration is not valid.");
  }

  if (
    deployment.maxDuration !== undefined &&
    (!Number.isSafeInteger(deployment.maxDuration) ||
      deployment.maxDuration < 1)
  ) {
    throw new Error("Vercel maxDuration must be a positive integer.");
  }

  if (
    deployment.regions !== undefined &&
    (!Array.isArray(deployment.regions) ||
      deployment.regions.length === 0 ||
      deployment.regions.some((region) =>
        typeof region !== "string" || region.trim() !== region || !region
      ))
  ) {
    throw new Error("Vercel regions must contain one or more region identifiers.");
  }
}
