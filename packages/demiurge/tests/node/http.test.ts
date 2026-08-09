import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import { toHeaders, toWebRequest, writeWebResponse } from "demiurge/node";

function incoming(init: Partial<IncomingMessage> = {}) {
  return Object.assign(Readable.from([Buffer.from("hello")]), {
    headers: {},
    method: "GET",
    url: "/health?ready=true",
    ...init,
  }) as IncomingMessage;
}

describe("Node HTTP bridge", () => {
  it("converts incoming headers and request metadata", () => {
    const request = toWebRequest(
      incoming({
        headers: {
          host: "example.test",
          "x-request-id": ["one", "two"],
        },
      }),
      { protocol: "https" },
    );

    expect(request.url).toBe("https://example.test/health?ready=true");
    expect(request.headers.get("x-request-id")).toBe("one, two");
    expect(request.method).toBe("GET");
  });

  it("preserves request bodies for non-GET methods", async () => {
    const request = toWebRequest(
      incoming({
        headers: { host: "example.test" },
        method: "POST",
      }),
    );

    await expect(request.text()).resolves.toBe("hello");
  });

  it("converts Node response metadata and repeated cookies", async () => {
    const headers = new Map<string, string | string[]>();
    let body = "";
    const response = new Writable({
      write(chunk, _encoding, callback) {
        body += String(chunk);
        callback();
      },
    });
    const nodeResponse = Object.assign(response, {
      setHeader(name: string, value: string | string[]) {
        headers.set(name, value);
      },
      statusCode: 0,
      statusMessage: "",
    }) as unknown as ServerResponse;
    const webResponse = new Response("hello", { status: 201 });
    webResponse.headers.append("set-cookie", "a=1");
    webResponse.headers.append("set-cookie", "b=2");
    webResponse.headers.set("x-test", "ok");

    await writeWebResponse(nodeResponse, webResponse);

    expect(nodeResponse.statusCode).toBe(201);
    expect(headers.get("set-cookie")).toEqual(["a=1", "b=2"]);
    expect(headers.get("x-test")).toBe("ok");
    expect(body).toBe("hello");
  });

  it("supports empty responses and direct header conversion", async () => {
    const output: string[] = [];
    const writable = new Writable({
      write(chunk, _encoding, callback) {
        output.push(String(chunk));
        callback();
      },
    });
    const response = Object.assign(writable, {
      setHeader() {},
      statusCode: 0,
      statusMessage: "",
    }) as unknown as ServerResponse;

    await writeWebResponse(response, new Response(null, { status: 204 }));

    expect(response.statusCode).toBe(204);
    expect(output).toEqual([]);
    expect(toHeaders({ accept: "text/html" }).get("accept")).toBe("text/html");
  });
});
