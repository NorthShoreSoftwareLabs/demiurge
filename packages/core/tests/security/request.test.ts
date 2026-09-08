import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MAX_BODY_SIZE,
  enforceRequestSecurity,
  limitRequestBody,
  parseBodySize,
  RequestBodyTooLargeError,
} from "../../src/security/request";

const defaultMaxBodyBytes = parseBodySize(DEFAULT_MAX_BODY_SIZE);

function requestWithDeclaredLength(byteLength: number) {
  return new Request("https://example.test/api/echo", {
    body: "x".repeat(byteLength),
    headers: { "content-length": String(byteLength) },
    method: "POST",
  });
}

// A stream that never declares Content-Length and yields chunks of the given
// size until the caller stops reading it. Each pull is recorded so a test can
// prove the framework stopped reading near the limit instead of buffering the
// entire body.
function createUnboundedSource(chunkSize: number) {
  const pulls: number[] = [];
  const chunk = new Uint8Array(chunkSize).fill(1);
  let cancelled: unknown;
  const stream = new ReadableStream<Uint8Array>({
    cancel(reason) {
      cancelled = reason ?? true;
    },
    pull(controller) {
      pulls.push(chunk.byteLength);
      controller.enqueue(chunk);
    },
  });

  return {
    pulls,
    stream,
    wasCancelled: () => cancelled !== undefined,
  };
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let bytesRead = 0;

  try {
    while (true) {
      const result = await reader.read();

      if (result.done) {
        return bytesRead;
      }

      bytesRead += result.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

describe("bounded request defaults", () => {
  it("inherits the ADR-0015 default body limit when no policy declares one", () => {
    const oversized = requestWithDeclaredLength(defaultMaxBodyBytes + 1);

    const response = enforceRequestSecurity(undefined, oversized, "POST");

    expect(response?.status).toBe(413);
  });

  it("allows a declared Content-Length within the inherited default", () => {
    const withinLimit = requestWithDeclaredLength(defaultMaxBodyBytes);

    const response = enforceRequestSecurity(undefined, withinLimit, "POST");

    expect(response).toBeNull();
  });

  it("honors an explicit raise above the inherited default", () => {
    const raised = requestWithDeclaredLength(defaultMaxBodyBytes + 1);

    const response = enforceRequestSecurity(
      { maxBodySize: "2mb" },
      raised,
      "POST",
    );

    expect(response).toBeNull();
  });

  it("honors an explicit lower limit below the inherited default", () => {
    const request = requestWithDeclaredLength(100);

    const response = enforceRequestSecurity(
      { maxBodySize: "10b" },
      request,
      "POST",
    );

    expect(response?.status).toBe(413);
  });

  it("bounds a streaming body with no Content-Length at the inherited default", async () => {
    const source = createUnboundedSource(64 * 1024);
    const request = new Request("https://example.test/api/echo", {
      body: source.stream,
      duplex: "half",
      method: "POST",
    } as RequestInit);

    const limited = limitRequestBody(undefined, request);

    await expect(drain(limited.body!)).rejects.toThrow(
      RequestBodyTooLargeError,
    );

    const totalPulledBytes = source.pulls.reduce((sum, size) => sum + size, 0);

    // The failure happens once the stream crosses the default limit, not
    // after the source is exhausted. A generous margin (one extra chunk)
    // proves the framework stopped reading near the boundary rather than
    // buffering an unbounded body.
    expect(totalPulledBytes).toBeGreaterThan(defaultMaxBodyBytes);
    expect(totalPulledBytes).toBeLessThanOrEqual(defaultMaxBodyBytes + 64 * 1024 * 3);
  });

  it("bounds a streaming body at an explicitly lowered limit", async () => {
    const source = createUnboundedSource(4);
    const request = new Request("https://example.test/api/echo", {
      body: source.stream,
      duplex: "half",
      method: "POST",
    } as RequestInit);

    const limited = limitRequestBody({ maxBodySize: "4b" }, request);

    await expect(drain(limited.body!)).rejects.toThrow(
      RequestBodyTooLargeError,
    );

    const totalPulledBytes = source.pulls.reduce((sum, size) => sum + size, 0);
    expect(totalPulledBytes).toBeLessThan(64);
  });

  it("releases the source reader when the limited body is read past the cap", async () => {
    const source = createUnboundedSource(4);
    const request = new Request("https://example.test/api/echo", {
      body: source.stream,
      duplex: "half",
      method: "POST",
    } as RequestInit);

    const limited = limitRequestBody({ maxBodySize: "4b" }, request);

    await expect(drain(limited.body!)).rejects.toThrow(
      RequestBodyTooLargeError,
    );

    expect(source.wasCancelled()).toBe(true);
  });

  it("releases the reader when the caller cancels the limited body", async () => {
    const cancelSpy = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelSpy(reason);
      },
      pull(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
      },
    });
    const request = new Request("https://example.test/api/echo", {
      body: stream,
      duplex: "half",
      method: "POST",
    } as RequestInit);

    const limited = limitRequestBody(undefined, request);
    const reason = new DOMException("Client disconnected.", "AbortError");

    await limited.body!.cancel(reason);

    expect(cancelSpy).toHaveBeenCalledWith(reason);
  });
});
