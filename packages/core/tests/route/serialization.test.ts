import { describe, expect, it } from "vitest";
import {
  assertSerializableValue,
  RouteSerializationError,
} from "../../src/route/serialization";

describe("assertSerializableValue", () => {
  it("accepts a null value", () => {
    expect(() => assertSerializableValue(null, "/account")).not.toThrow();
  });

  it("accepts a top-level undefined value", () => {
    expect(() => assertSerializableValue(undefined, "/account")).not.toThrow();
  });

  it("accepts a nested undefined value", () => {
    expect(() =>
      assertSerializableValue({ profile: { name: undefined } }, "/account")
    ).not.toThrow();
  });

  it("accepts a nested function", () => {
    expect(() =>
      assertSerializableValue({ profile: { greet: () => "hi" } }, "/account")
    ).not.toThrow();
  });

  it("accepts a nested non-finite number", () => {
    expect(() =>
      assertSerializableValue({ profile: { size: Number.NaN } }, "/account")
    ).not.toThrow();
  });

  it("accepts a nested class instance", () => {
    expect(() =>
      assertSerializableValue({ profile: { at: new Date(0) } }, "/account")
    ).not.toThrow();
  });

  it("accepts a symbol key", () => {
    expect(() =>
      assertSerializableValue({ [Symbol("token")]: "secret" }, "/account")
    ).not.toThrow();
  });

  it("names the field of a nested bigint", () => {
    expect(() =>
      assertSerializableValue({ profile: { size: 1n } }, "/account")
    ).toThrow(
      "Route /account could not serialize the field profile.size for the browser.",
    );
  });

  it("accepts an array of serializable values", () => {
    expect(() =>
      assertSerializableValue({ tags: ["a", "b", 1] }, "/account")
    ).not.toThrow();
  });

  it("names the index of an array element that is a bigint", () => {
    expect(() =>
      assertSerializableValue({ tags: ["a", 1n] }, "/account")
    ).toThrow(
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

  it("reports the root when the value itself is unsupported", () => {
    expect(() => assertSerializableValue(1n, "/account")).toThrow(
      "Route /account could not serialize the field <root> for the browser.",
    );
  });

  it("throws a RouteSerializationError that carries the route and the field", () => {
    try {
      assertSerializableValue({ profile: { size: 1n } }, "/account");
      throw new Error("expected assertSerializableValue to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RouteSerializationError);
      expect((error as RouteSerializationError).route).toBe("/account");
      expect((error as RouteSerializationError).field).toBe("profile.size");
    }
  });

  it("does not contain the value in the message", () => {
    const secret = "refresh-secret-9f2c41d0";
    try {
      assertSerializableValue({ token: BigInt(1) }, "/account");
      throw new Error("expected assertSerializableValue to throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });
});
