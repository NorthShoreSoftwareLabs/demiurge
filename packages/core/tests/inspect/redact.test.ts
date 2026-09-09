import { describe, expect, it } from "vitest";
import {
  redactSecrets,
  REDACTED_VALUE,
  serializeInspectionReport,
} from "../../src/inspect";

const sessionSecret = "s3cr3t-session-signing-key";
const cookieSecret = "c00kie-payload-value";
const sessionData = "the-session-holds-this";

describe("inspection report redaction", () => {
  it("removes a value that an environment secret declaration produced", () => {
    const result = redactSecrets(
      { environment: { PUBLIC_URL: "https://example.test", SESSION_SECRET: sessionSecret } },
      { secretEnvKeys: ["SESSION_SECRET"] },
    );

    expect(result.value).toEqual({
      environment: {
        PUBLIC_URL: "https://example.test",
        SESSION_SECRET: REDACTED_VALUE,
      },
    });
    expect(result.redactions).toEqual([
      {
        name: "SESSION_SECRET",
        path: "environment.SESSION_SECRET",
        reason: "environment-secret",
      },
    ]);
  });

  it("removes the payload of a cookie and keeps the other attributes", () => {
    const result = redactSecrets({
      cookie: { name: "__Host-session", sameSite: "Strict", value: cookieSecret },
    });

    expect(result.value).toEqual({
      cookie: { name: "__Host-session", sameSite: "Strict", value: REDACTED_VALUE },
    });
    expect(result.redactions).toEqual([
      { name: "value", path: "cookie.value", reason: "cookie-value" },
    ]);
  });

  it("removes a cookie header that a report states as one string", () => {
    const result = redactSecrets({ headers: { "set-cookie": cookieSecret } });

    expect(result.value).toEqual({ headers: { "set-cookie": REDACTED_VALUE } });
    expect(result.redactions[0]?.reason).toBe("cookie-value");
  });

  it("removes the data and the identifier of a session record", () => {
    const result = redactSecrets({
      current: {
        createdAt: 1,
        data: { token: sessionData },
        expiresAt: 2,
        id: "session-identifier",
        version: 1,
      },
    });

    expect(result.value).toEqual({
      current: {
        createdAt: 1,
        data: REDACTED_VALUE,
        expiresAt: 2,
        id: REDACTED_VALUE,
        version: 1,
      },
    });
    expect(result.redactions.map((entry) => entry.reason)).toEqual([
      "session-record",
      "session-record",
    ]);
  });

  it("removes a session value inside an array of records", () => {
    const result = redactSecrets({
      sessions: [{ id: "one", label: "first" }],
    });

    expect(result.value).toEqual({
      sessions: [{ id: REDACTED_VALUE, label: "first" }],
    });
    expect(result.redactions[0]?.path).toBe("sessions[0].id");
  });

  it("proves that no secret value reaches the serialized report", () => {
    const json = serializeInspectionReport(
      {
        cookies: [{ name: "sid", value: cookieSecret }],
        environment: { SESSION_SECRET: sessionSecret },
        redactions: [],
        session: {
          createdAt: 1,
          data: { token: sessionData },
          expiresAt: 2,
          id: "session-identifier",
          version: 1,
        },
      },
      { secretEnvKeys: ["SESSION_SECRET"] },
    );

    expect(json).not.toContain(sessionSecret);
    expect(json).not.toContain(cookieSecret);
    expect(json).not.toContain(sessionData);

    const parsed = JSON.parse(json) as {
      redactions: Array<{ name: string; path: string; reason: string }>;
    };

    expect(parsed.redactions.map((entry) => entry.path)).toEqual([
      "cookies[0].value",
      "environment.SESSION_SECRET",
      "session.data",
      "session.id",
    ]);
  });

  it("keeps a report that declares no redactions field unchanged", () => {
    const json = serializeInspectionReport({ code: "invalid-argument" }, {
      space: 0,
    });

    expect(json).toBe('{"code":"invalid-argument"}');
  });

  it("returns a value that is not a record without a change", () => {
    expect(redactSecrets("plain").value).toBe("plain");
    expect(serializeInspectionReport([1, 2], { space: 0 })).toBe("[1,2]");
  });

  it("keeps a class instance rather than walking its fields", () => {
    const date = new Date(0);
    const result = redactSecrets({ generatedAt: date });

    expect((result.value as { generatedAt: Date }).generatedAt).toBe(date);
  });

  it("keeps a cookie field that holds a number", () => {
    const result = redactSecrets({ cookie: 42 });

    expect(result.value).toEqual({ cookie: 42 });
    expect(result.redactions).toEqual([]);
  });
});
