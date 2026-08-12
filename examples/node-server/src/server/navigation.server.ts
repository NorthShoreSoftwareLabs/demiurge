export const SERVER_ONLY_NAVIGATION_SENTINEL =
  "DEMIURGE_SERVER_ONLY_NAVIGATION_CALLBACK";

export function recordServerNavigationContribution(kind: string) {
  if (typeof document !== "undefined") {
    throw new Error(`${kind} executed in the browser.`);
  }

  return SERVER_ONLY_NAVIGATION_SENTINEL;
}
