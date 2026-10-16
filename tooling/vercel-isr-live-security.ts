export function nonceMatchesBody(policy: string | null, body: string): boolean | null {
  if (!policy?.includes("nonce-")) return null;
  const sources = new Set(policy.split(/[\s;]+/));
  const nonces = [...body.matchAll(/nonce="([^"]+)"/g)];
  return nonces.length > 0 && nonces.every((match) => sources.has(`'nonce-${match[1]}'`));
}
