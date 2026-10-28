import { nonceMatchesBody } from "./vercel-isr-live-security";

export type NodeLiveRow = {
  name: string;
  status: number;
  contentType: string | null;
  cacheControl: string | null;
  cache: string | null;
  csp: string | null;
  nosniff: string | null;
  generation: string | null;
  runtime: string | null;
  cookies: string[];
  body: string;
  privateIdentityMatches?: boolean;
  firstByteMs: number;
  totalMs: number;
};

export function assessNodeLive(rows: readonly NodeLiveRow[], events: readonly { id: string; event: string }[] = []): string[] {
  const failures: string[] = [];
  const named = (name: string) => rows.find((row) => row.name === name);
  const require = (condition: unknown, message: string) => { if (!condition) failures.push(message); };
  const first = named("document-first");
  const second = named("document-second");
  for (const row of [first, second]) {
    require(row?.status === 200 && row.contentType?.includes("text/html"), "A document response is missing.");
    require(row?.cacheControl === "private, no-store" && row.cache !== "HIT", "A runtime response entered shared storage.");
    require(row && nonceMatchesBody(row.csp, row.body), "A document nonce does not match its CSP.");
    require(row?.nosniff === "nosniff", "A security header is missing.");
    require(row?.generation && /^v(?:22|2[4-9]|[3-9][0-9])\./.test(row.runtime ?? ""), "The function runtime evidence is missing.");
  }
  require(first?.generation && second?.generation && first.generation !== second.generation, "Repeated documents reused a generation.");
  require(first?.csp && second?.csp && first.csp !== second.csp, "Repeated documents reused a nonce.");
  const cookies = named("cookies");
  require(cookies?.status === 200 && cookies.cookies.length === 2 && cookies.cookies.some((value) => value.startsWith("proof-a=")) && cookies.cookies.some((value) => value.startsWith("proof-b=")), "Repeated Set-Cookie headers were lost.");
  const navigation = named("navigation");
  require(navigation?.status === 200 && navigation.contentType?.includes("application/json") && navigation.cacheControl === "private, no-store", "Navigation did not return private JSON.");
  for (const identity of ["one", "two"]) {
    const row = named(`private-${identity}`);
    require(row?.status === 200 && row.privateIdentityMatches === true && row.cacheControl === "private, no-store" && row.cache !== "HIT", "A private response lost its identity or storage exclusion.");
  }
  const request = named("request");
  try {
    const body: unknown = JSON.parse(request?.body ?? "null");
    require(typeof body === "object" && body !== null && "pathname" in body && body.pathname === "/probe/request" && "search" in body && body.search === "?edition=one&edition=two" && "address" in body && typeof body.address === "string" && body.address !== "203.0.113.123", "The provider did not preserve the URL or replace the spoofed client address.");
  } catch { failures.push("The request evidence is invalid."); }
  const stream = named("stream");
  require(stream?.status === 200 && stream.body === `started\n${"continued\n".repeat(7)}` && stream.totalMs - stream.firstByteMs >= 4000, "The provider did not deliver a response before streaming completed.");
  const cancelled = named("cancelled-stream");
  require(cancelled?.status === 200 && cancelled.body.startsWith("started\n") && !cancelled.body.includes("continued"), "The client cancellation probe is missing.");
  const capabilities = named("capabilities");
  try {
    const body: unknown = JSON.parse(capabilities?.body ?? "null");
    require(typeof body === "object" && body !== null && "backgroundLifetime" in body && body.backgroundLifetime === false && "responseBodyCompletion" in body && body.responseBodyCompletion === true && "streaming" in body && body.streaming === true && "backgroundRejected" in body && body.backgroundRejected === true, "The artifact has incorrect lifecycle claims.");
  } catch { failures.push("The lifecycle evidence is invalid."); }
  require(events.some((event) => event.id === "complete" && event.event === "completed"), "The origin did not finish the response body.");
  require(events.some((event) => event.id === "cancel" && event.event === "started") && events.some((event) => event.id === "cancel" && event.event === "aborted"), "The origin did not observe request cancellation.");
  return failures;
}
