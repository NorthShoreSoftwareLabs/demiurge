const versions = new Map<string, number>();

export function readMutationVersion(key: string) {
  return versions.get(key) ?? 0;
}

export function incrementMutationVersion(key: string) {
  const version = readMutationVersion(key) + 1;
  versions.set(key, version);
  return version;
}
