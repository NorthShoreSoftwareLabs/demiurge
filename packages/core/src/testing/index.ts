import {
  createRequestHandler,
  type RequestHandler,
  type RequestHandlerOptions,
} from "../server";

const testOrigin = "https://demiurge.test";

export type ApplicationTest = {
  request(input: Request | string | URL): Promise<Response>;
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

function toRequest(input: Request | string | URL): Request {
  if (input instanceof Request) {
    return input;
  }

  return new Request(new URL(input, testOrigin));
}
