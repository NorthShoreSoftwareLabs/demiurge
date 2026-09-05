import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  assertSerializableValue,
  declaresDisclosure,
  projectRouteData,
} from "../../src/route/projection";

type AccountRecord = { id: string; token: string };

function publicAccountSchema(): StandardSchemaV1<AccountRecord, { id: string }> {
  return {
    "~standard": {
      validate(value: unknown) {
        // TYPE-EVIDENCE: the caller passes the account record. The cast labels the value with that shape.
        const record = value as AccountRecord;
        if (typeof record.id !== "string") {
          return { issues: [{ message: "The id is not a string.", path: ["id"] }] };
        }
        return { value: { id: record.id } };
      },
      vendor: "test",
      version: 1,
    },
  };
}

describe("route data projection", () => {
  it("reports a route that declares nothing", async () => {
    await expect(projectRouteData({
      data: { id: "acct-1" },
      declaration: {},
      route: "/account",
    })).rejects.toThrow(
      "Route /account returns page data and declares no browser disclosure.",
    );
  });

  it("returns the whole result for a public declaration", async () => {
    await expect(projectRouteData({
      data: { id: "acct-1" },
      declaration: { publicData: true },
      route: "/account",
    })).resolves.toEqual({ id: "acct-1" });
  });

  it("selects fields with a projection function", async () => {
    await expect(projectRouteData({
      data: { id: "acct-1", token: "secret" },
      declaration: { project: (record: AccountRecord) => ({ id: record.id }) },
      route: "/account",
    })).resolves.toEqual({ id: "acct-1" });
  });

  it("selects fields with a Standard Schema", async () => {
    await expect(projectRouteData({
      data: { id: "acct-1", token: "secret" },
      declaration: { project: publicAccountSchema() },
      route: "/account",
    })).resolves.toEqual({ id: "acct-1" });
  });

  it("names the field that an output schema refuses", async () => {
    await expect(projectRouteData({
      data: { id: 1, token: "secret" },
      declaration: { project: publicAccountSchema() },
      route: "/account",
    })).rejects.toThrow(
      "Route /account could not project the field id. The output schema refused the value.",
    );
  });

  it("reports a projection that is neither a function nor a schema", async () => {
    await expect(projectRouteData({
      data: { id: "acct-1" },
      declaration: { project: { id: true } },
      route: "/account",
    })).rejects.toThrow(
      "Route /account declares a projection that is not a function and not a Standard Schema.",
    );
  });

  it("reports a mutation route that declares nothing", async () => {
    await expect(projectRouteData({
      data: { id: "acct-1" },
      declaration: {},
      kind: "mutation",
      route: "/account",
    })).rejects.toThrow(
      "Route /account returns mutation data and declares no browser disclosure.",
    );
  });

  it("accepts a top-level undefined value", () => {
    expect(() => assertSerializableValue(undefined, "/account")).not.toThrow();
  });

  it.each([
    ["a nested undefined", { profile: { name: undefined } }, "profile.name"],
    ["a nested function", { profile: { name: () => "ada" } }, "profile.name"],
    ["a nested bigint", { profile: { size: 1n } }, "profile.size"],
    ["a nested non-finite number", { profile: { size: Number.NaN } }, "profile.size"],
    ["a nested class instance", { profile: { at: new Date(0) } }, "profile.at"],
  ])("names the field of %s", (_name, value, field) => {
    expect(() => assertSerializableValue(value, "/account")).toThrow(
      `Route /account could not serialize the field ${field} for the browser.`,
    );
  });

  it("names the index of an unsupported array element", () => {
    expect(() => assertSerializableValue({ tags: ["a", 1n] }, "/account")).toThrow(
      "Route /account could not serialize the field tags.1 for the browser.",
    );
  });

  it("names the field of a cycle", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(() => assertSerializableValue(value, "/account")).toThrow(
      "Route /account could not serialize the field self for the browser.",
    );
  });

  it("names the field of a getter", () => {
    const value = Object.defineProperty({}, "token", {
      enumerable: true,
      get: () => "secret",
    });
    expect(() => assertSerializableValue(value, "/account")).toThrow(
      "Route /account could not serialize the field token for the browser.",
    );
  });

  it("names a symbol key that it cannot serialize", () => {
    const value = { [Symbol("token")]: "secret" };
    expect(() => assertSerializableValue(value, "/account")).toThrow(
      "Route /account could not serialize the field <symbol> for the browser.",
    );
  });

  it("reports the root when the value itself is unsupported", () => {
    expect(() => assertSerializableValue(1n, "/account")).toThrow(
      "Route /account could not serialize the field <root> for the browser.",
    );
  });

  it("accepts a null prototype object and a nested array", () => {
    const value = Object.assign(Object.create(null), { tags: ["a", "b"] });
    expect(() => assertSerializableValue(value, "/account")).not.toThrow();
  });

  it("reports whether a declaration exists", () => {
    expect(declaresDisclosure({})).toBe(false);
    expect(declaresDisclosure({ publicData: true })).toBe(true);
    expect(declaresDisclosure({ project: () => ({}) })).toBe(true);
  });
});
