import { describe, expect, it } from "vitest";
import { createSecurityReportHandler } from "demiurge";

describe("security report endpoint handler", () => {
  it("accepts CSP report payloads and calls the report callback", async () => {
    const received: unknown[] = [];
    const handler = createSecurityReportHandler({
      onReport(report) {
        received.push(report);
      },
    });

    const response = await handler(
      new Request("https://app.example.com/.well-known/security-reports", {
        body: JSON.stringify({
          "csp-report": {
            "blocked-uri": "https://evil.example.com/script.js",
            "document-uri": "https://app.example.com/",
            "violated-directive": "script-src",
          },
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(204);
    expect(received).toEqual([
      {
        "blocked-uri": "https://evil.example.com/script.js",
        "document-uri": "https://app.example.com/",
        "violated-directive": "script-src",
      },
    ]);
  });

  it("accepts batched Reporting API payloads with report indexes", async () => {
    const received: Array<{ index: number; report: unknown }> = [];
    const handler = createSecurityReportHandler({
      onReport(report, context) {
        received.push({
          index: context.index,
          report,
        });
      },
    });

    await handler(
      new Request("https://app.example.com/reports", {
        body: JSON.stringify([
          {
            body: {
              blockedURL: "https://cdn.example.com/a.js",
            },
            type: "csp-violation",
            url: "https://app.example.com/",
          },
          {
            body: {
              disposition: "enforce",
            },
            type: "coop",
            url: "https://app.example.com/",
          },
        ]),
        method: "POST",
      }),
    );

    expect(received).toEqual([
      {
        index: 0,
        report: {
          body: {
            blockedURL: "https://cdn.example.com/a.js",
          },
          type: "csp-violation",
          url: "https://app.example.com/",
        },
      },
      {
        index: 1,
        report: {
          body: {
            disposition: "enforce",
          },
          type: "coop",
          url: "https://app.example.com/",
        },
      },
    ]);
  });

  it("rejects unsupported methods, invalid JSON, and oversized reports", async () => {
    const handler = createSecurityReportHandler({
      maxBodySize: "8b",
    });

    const getResponse = await handler(
      new Request("https://app.example.com/reports", {
        method: "GET",
      }),
    );
    const invalidJsonResponse = await handler(
      new Request("https://app.example.com/reports", {
        body: "not json",
        method: "POST",
      }),
    );
    const oversizedResponse = await handler(
      new Request("https://app.example.com/reports", {
        body: "{}",
        headers: {
          "content-length": "9",
        },
        method: "POST",
      }),
    );

    expect(getResponse.status).toBe(405);
    expect(getResponse.headers.get("allow")).toBe("POST");
    expect(invalidJsonResponse.status).toBe(400);
    expect(await invalidJsonResponse.text()).toBe("Invalid security report JSON.");
    expect(oversizedResponse.status).toBe(413);
    expect(await oversizedResponse.text()).toBe("Security report body too large.");
  });
});
