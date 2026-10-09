import { describe, expect, it } from "vitest";
import {
  createRuntimeTraceCarrier,
  extractRuntimeTraceContext,
  injectTraceContext,
  parseTraceContext,
} from "@demiurgejs/core";

const validTraceparent =
  "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("W3C trace context", () => {
  it("accepts empty list members and preserves leading value spaces", () => {
    const context = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: "vendor= value,, \t,other=two",
    }));
    expect(context?.traceState).toBe("vendor= value,other=two");
    const headers = new Headers();
    expect(injectTraceContext(headers, context)).toBe(true);
    expect(headers.get("tracestate")).toBe("vendor= value,other=two");
  });

  it.each(["vendor =value", "vendor\t=value", "vendor=\tvalue", "vendor=value,\u00a0other=two"])(
    "rejects whitespace outside the W3C grammar: %s",
    (tracestate) => {
      const context = parseTraceContext(new Headers({ traceparent: validTraceparent, tracestate }));
      expect(context).not.toHaveProperty("traceState");
    },
  );

  it("returns no context when traceparent is absent", () => {
    expect(parseTraceContext(new Headers({ tracestate: "vendor=value" })))
      .toBeUndefined();
  });

  it("parses the remote parent and sampling flag", () => {
    const context = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: "vendor=value, other=two",
      baggage: "user.id=private",
    }));

    expect(context).toEqual({
      isRemote: true,
      sampled: true,
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      traceState: "vendor=value,other=two",
    });
    expect(JSON.stringify(context)).not.toContain("private");
  });

  it.each([
    "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
    "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
    "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    `${validTraceparent}-extra`,
    "00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01",
    "00-bad-00f067aa0ba902b7-01",
    `01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-${"x".repeat(512)}`,
  ])("ignores malformed traceparent %s", (traceparent) => {
    expect(parseTraceContext(new Headers({
      traceparent,
      tracestate: "vendor=value",
    }))).toBeUndefined();
  });

  it("accepts a future version prefix and ignores its extension fields", () => {
    const context = parseTraceContext(new Headers({
      traceparent:
        "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-extra-field",
    }));

    expect(context).toMatchObject({
      sampled: true,
      spanId: "00f067aa0ba902b7",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
  });

  it("discards invalid tracestate without losing valid traceparent", () => {
    const context = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: "vendor=one,vendor=two",
    }));

    expect(context?.sampled).toBe(true);
    expect(context).not.toHaveProperty("traceState");
  });

  it("drops tracestate values that exceed the header and member limits", () => {
    const overSize = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: `vendor=${"x".repeat(506)}`,
    }));
    const overMemberCount = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: Array.from({ length: 33 }, (_, index) => `vendor${index}=x`).join(","),
    }));
    const overValueSize = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: `vendor=${"x".repeat(257)}`,
    }));

    expect(overSize).not.toHaveProperty("traceState");
    expect(overMemberCount).not.toHaveProperty("traceState");
    expect(overValueSize).not.toHaveProperty("traceState");
  });

  it("validates the tenant and system parts of tracestate keys", () => {
    const accepted = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: "1tenant@system=value",
    }));
    const rejected = parseTraceContext(new Headers({
      traceparent: validTraceparent,
      tracestate: "tenant@1system=value",
    }));

    expect(accepted?.traceState).toBe("1tenant@system=value");
    expect(rejected).not.toHaveProperty("traceState");
  });

  it("passes baggage to an extractor only when the application opts in", () => {
    const headers = new Headers({
      baggage: "user.id=private",
      traceparent: validTraceparent,
    });
    const observed: Array<string | null> = [];

    extractRuntimeTraceContext(headers, {
      extract(carrier) {
        observed.push(carrier.get("baggage"));
        return undefined;
      },
    });
    extractRuntimeTraceContext(headers, {
      allowBaggage: true,
      extract(carrier) {
        observed.push(carrier.get("baggage"));
        return undefined;
      },
    });

    expect(observed).toEqual([null, "user.id=private"]);
  });

  it("uses the validated W3C parent when a provider extractor fails", () => {
    const context = extractRuntimeTraceContext(
      new Headers({ traceparent: validTraceparent }),
      {
        extract() {
          throw new Error("provider failure");
        },
      },
    );

    expect(context).toMatchObject({
      sampled: true,
      spanId: "00f067aa0ba902b7",
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });
  });

  it("injects only a valid span context", () => {
    const headers = new Headers({ baggage: "user.id=private" });
    const injected = injectTraceContext(headers, {
      spanId: "828c5d0d435ba505",
      traceFlags: 0,
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    });

    expect(injected).toBe(true);
    expect(headers.get("traceparent")).toBe(
      "00-4bf92f3577b34da6a3ce929d0e0e4736-828c5d0d435ba505-00",
    );
    expect(headers.get("baggage")).toBe("user.id=private");
    expect(injectTraceContext(headers, { traceId: "bad" })).toBe(false);
  });

  it("contains provider injection failures and discards partial header changes", () => {
    const headers = new Headers({ accept: "application/json" });
    headers.append("set-cookie", "first=1");
    headers.append("set-cookie", "second=2");
    const carrier = createRuntimeTraceCarrier(
      { spanId: "00f067aa0ba902b7", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
      {
        inject(_context, outgoing) {
          outgoing.set("traceparent", validTraceparent);
          throw new Error("provider failure");
        },
      },
    );

    carrier.inject(headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.getSetCookie()).toEqual(["first=1", "second=2"]);
    expect(headers.get("traceparent")).toBeNull();
  });

  it("preserves unrelated headers and applies provider headers without collapsing cookies", () => {
    const headers = new Headers({ baggage: "app.value=keep", "x-app": "value" });
    headers.append("set-cookie", "first=1");
    headers.append("set-cookie", "second=2");
    createRuntimeTraceCarrier(
      { spanId: "00f067aa0ba902b7", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
      {
        inject(_context, outgoing) {
          outgoing.set("traceparent", validTraceparent);
          outgoing.set("x-provider-context", "translated");
          outgoing.set("baggage", "provider.value=private");
        },
      },
    ).inject(headers);

    expect(headers.get("x-app")).toBe("value");
    expect(headers.get("x-provider-context")).toBe("translated");
    expect(headers.get("baggage")).toBe("app.value=keep");
    expect(headers.getSetCookie()).toEqual(["first=1", "second=2"]);
    expect(headers.get("traceparent")).toBe(validTraceparent);
  });

  it("leaves all headers untouched when the context is invalid", () => {
    const headers = new Headers({ accept: "application/json" });
    headers.append("set-cookie", "first=1");
    headers.append("set-cookie", "second=2");
    const carrier = createRuntimeTraceCarrier({ traceId: "invalid" });

    carrier.inject(headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("traceparent")).toBeNull();
    expect(headers.getSetCookie()).toEqual(["first=1", "second=2"]);
  });

  it("applies provider header removals and rejects invalid provider trace output", () => {
    const removedHeaders = new Headers({ "x-app": "remove" });
    createRuntimeTraceCarrier(
      { spanId: "00f067aa0ba902b7", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
      {
        inject(_context, outgoing) {
          outgoing.delete("x-app");
          outgoing.set("traceparent", validTraceparent);
        },
      },
    ).inject(removedHeaders);

    const invalidHeaders = new Headers({ "x-app": "keep", traceparent: validTraceparent });
    createRuntimeTraceCarrier(
      { spanId: "00f067aa0ba902b7", traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
      {
        inject(_context, outgoing) {
          outgoing.set("x-app", "partial");
          outgoing.set("traceparent", "invalid");
        },
      },
    ).inject(invalidHeaders);

    expect(removedHeaders.get("x-app")).toBeNull();
    expect(removedHeaders.get("traceparent")).toBe(validTraceparent);
    expect(invalidHeaders.get("x-app")).toBe("keep");
    expect(invalidHeaders.get("traceparent")).toBe(validTraceparent);
  });
});
