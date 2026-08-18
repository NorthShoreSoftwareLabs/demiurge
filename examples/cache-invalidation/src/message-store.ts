// The "source of truth" a real app would keep in a database. `sourceReads`
// only increments when a query actually calls `readMessage`. It proves in
// the integration test that the cache, not the source, served most reads.
let message = "Welcome to Demiurge.";
let sourceReads = 0;

export function readMessage() {
  sourceReads += 1;

  return { message, sourceReads };
}

export function writeMessage(next: string) {
  message = next;
}
