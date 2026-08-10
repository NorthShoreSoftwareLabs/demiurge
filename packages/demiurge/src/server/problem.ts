export const PROBLEM_CONTENT_TYPE = "application/problem+json";

export type ProblemDetails = {
  detail?: string;
  instance?: string;
  status: number;
  title: string;
  type?: string;
};

// RFC 9457, which obsoleted RFC 7807. Shipping this as the framework default
// is the lever for pushing apps toward correct status codes and a parseable
// error shape rather than everyone inventing `{ "error": "..." }`.
export function createProblemDetails({
  detail,
  instance,
  status,
  title,
  type = "about:blank",
}: ProblemDetails) {
  return {
    type,
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    ...(instance === undefined ? {} : { instance }),
  };
}

export function createProblemResponse(
  problem: ProblemDetails,
  init?: ResponseInit,
) {
  return new Response(JSON.stringify(createProblemDetails(problem)), {
    ...init,
    headers: {
      "content-type": `${PROBLEM_CONTENT_TYPE}; charset=utf-8`,
      ...init?.headers,
    },
    status: problem.status,
  });
}
