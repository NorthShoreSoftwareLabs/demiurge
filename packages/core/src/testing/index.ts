import {
  createRequestHandler,
  type RequestHandler,
  type RequestHandlerOptions,
} from "../server";

const testOrigin = "https://demiurge.test";

export type ApplicationTest = {
  request(input: Request | string | URL): Promise<Response>;
};

type ExpectedValue = RegExp | string;

export type DocumentAssertion = {
  title?: ExpectedValue;
  scripts?: readonly {
    src?: ExpectedValue;
    strategy?: ExpectedValue;
  }[];
};

export type SecurityAssertion = {
  cacheControl?: ExpectedValue;
  csp?: ExpectedValue;
  nonce?: boolean;
  headers?: Readonly<Record<string, ExpectedValue>>;
};

/**
 * Creates a runner-neutral application request test boundary.
 *
 * A pathname uses https://demiurge.test as its origin. A URL keeps its origin.
 */
export function createApplicationTest(
  input: RequestHandler | RequestHandlerOptions,
): ApplicationTest {
  const handler = typeof input === "function" ? input : createRequestHandler(input);

  return {
    async request(input) {
      return await handler(toRequest(input));
    },
  };
}

/**
 * Asserts document metadata and framework-managed scripts in a response.
 */
export async function assertDocument(
  response: Response,
  expected: DocumentAssertion,
): Promise<void> {
  const document = await response.clone().text();

  if (expected.title) {
    const title = /<title>([\s\S]*?)<\/title>/i.exec(document)?.[1] ?? "";
    assertValue(title, expected.title, "document title");
  }

  for (const script of expected.scripts ?? []) {
    const match = [...document.matchAll(/<script\b([^>]*)>/gi)].find(([, attributes]) => {
      if (!attributes.includes("data-demiurge-document-contribution")) return false;
      return (!script.src || matchesValue(readAttribute(attributes, "src") ?? "", script.src)) &&
        (!script.strategy || matchesValue(readAttribute(attributes, "data-demiurge-script-strategy") ?? "", script.strategy));
    });
    if (!match) {
      throw new Error("Expected a framework-managed script, but the document has none.");
    }

    if (script.src) assertValue(readAttribute(match[1], "src") ?? "", script.src, "managed script source");
    if (script.strategy) assertValue(readAttribute(match[1], "data-demiurge-script-strategy") ?? "", script.strategy, "managed script strategy");
  }
}

/**
 * Asserts security headers and their document cache and nonce compatibility.
 */
export async function assertSecurity(
  response: Response,
  expected: SecurityAssertion,
): Promise<void> {
  if (expected.csp) {
    assertValue(response.headers.get("content-security-policy") ?? "", expected.csp, "Content-Security-Policy header");
  }
  if (expected.cacheControl) {
    assertValue(response.headers.get("cache-control") ?? "", expected.cacheControl, "cache-control header");
  }
  for (const [name, value] of Object.entries(expected.headers ?? {})) {
    assertValue(response.headers.get(name) ?? "", value, `${name} header`);
  }
  if (expected.nonce === undefined) return;

  const document = await response.clone().text();
  const nonce = /\snonce="([^"]+)"/i.exec(document)?.[1];
  if (expected.nonce && !nonce) {
    throw new Error("Expected a document nonce, but the document has none.");
  }
  if (!expected.nonce && nonce) {
    throw new Error("Expected no document nonce, but the document has one.");
  }
  if (nonce && !response.headers.get("content-security-policy")?.includes(`'nonce-${nonce}'`)) {
    throw new Error("The document nonce is absent from the Content-Security-Policy header.");
  }
  if (nonce && !/\bprivate\b|\bno-store\b/i.test(response.headers.get("cache-control") ?? "")) {
    throw new Error("A nonce-backed document must use a private or no-store cache policy.");
  }
}

function toRequest(input: Request | string | URL): Request {
  if (input instanceof Request) {
    return input;
  }

  return new Request(new URL(input, testOrigin));
}

function assertValue(actual: string, expected: ExpectedValue, subject: string) {
  const matched = matchesValue(actual, expected);
  if (!matched) {
    throw new Error(`Expected ${subject} to match ${String(expected)}, but it was ${JSON.stringify(actual)}.`);
  }
}

function matchesValue(actual: string, expected: ExpectedValue) {
  if (typeof expected === "string") return actual === expected;
  expected.lastIndex = 0;
  return expected.test(actual);
}

function readAttribute(attributes: string, name: string) {
  return new RegExp(`\\s${name}="([^"]*)"`, "i").exec(attributes)?.[1];
}
