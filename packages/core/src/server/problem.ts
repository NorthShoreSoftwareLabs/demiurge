export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export type ProblemDetails = {
  detail?: string;
  instance?: string;
  status: number;
  title: string;
  type?: string;
  [extension: string]: unknown;
};

// RFC 9457 replaced RFC 7807. This framework default gives applications correct
// status codes and a parseable error format. Applications do not need to create
// separate `{ "error": "..." }` formats.
export function createProblemDetails({
  detail,
  instance,
  status,
  title,
  type = "about:blank",
  ...extensions
}: ProblemDetails) {
  return {
    type,
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(instance === undefined ? {} : { instance }),
    ...extensions,
  };
}

export function createProblemResponse(
  problem: ProblemDetails,
  init?: ResponseInit,
) {
  // Merge through `Headers` rather than object spread: `init.headers` may be
  // a Headers instance or an array of tuples, and spreading either silently
  // drops every header. The content type is set last because a problem+json
  // body announcing itself as something else is worse than ignoring a caller.
  const headers = new Headers(init?.headers);

  headers.set("content-type", `${PROBLEM_CONTENT_TYPE}; charset=utf-8`);

  return new Response(JSON.stringify(createProblemDetails(problem)), {
    ...init,
    headers,
    status: problem.status,
  });
}
