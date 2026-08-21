import { describe, expect, expectTypeOf, it } from "vitest";
import {
  HttpError,
  httpError,
  isHttpError,
  type HttpErrorStatus,
} from "@demiurgejs/core";

describe("httpError", () => {
  it("creates a typed error with safe defaults and an optional cause", () => {
    const cause = new Error("database unavailable");
    const error = httpError(503, undefined, {
      cause,
      headers: { "retry-after": "30" },
    });

    expect(error).toBeInstanceOf(HttpError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      cause,
      detail: undefined,
      message: "Service Unavailable",
      name: "HttpError",
      status: 503,
      title: "Service Unavailable",
      type: "about:blank",
    });
    expect(error.headers.get("retry-after")).toBe("30");
    expect(isHttpError(error)).toBe(true);
    expect(isHttpError(new Error("ordinary"))).toBe(false);
  });

  it("copies and freezes extension members", () => {
    const details = { detail: "invalid", errors: { slug: ["taken"] } };
    const error = httpError(422, details);

    details.errors = { slug: ["changed"] };

    expect(error.extensions).toEqual({ errors: { slug: ["taken"] } });
    expect(Object.isFrozen(error.extensions)).toBe(true);
  });

  it("rejects an unsupported status at runtime", () => {
    expect(() => httpError(200 as HttpErrorStatus)).toThrow(
      /standard 4xx or 5xx status/,
    );
  });

  it("constrains statuses at compile time", () => {
    expectTypeOf<403>().toExtend<HttpErrorStatus>();
    expectTypeOf<200>().not.toExtend<HttpErrorStatus>();
  });
});
