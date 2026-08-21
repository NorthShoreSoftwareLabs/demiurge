import { describe, expect, it } from "vitest";
import {
  applyFetchMetadataVary,
  checkFetchMetadata,
  enforceFetchMetadataPolicy,
} from "@demiurgejs/core";

function request(
  headers: Record<string, string>,
  init: RequestInit = {},
) {
  return new Request("https://app.example.com/reports", { ...init, headers });
}

describe("Fetch Metadata resource isolation", () => {
  it("allows a same-origin request and varies on the site field only", () => {
    expect(
      checkFetchMetadata(true, request({
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      })),
    ).toEqual({
      allowed: true,
      reason: "same-origin",
      vary: ["Sec-Fetch-Site"],
    });
  });

  it("allows a request that the user started from the address bar", () => {
    expect(
      checkFetchMetadata(true, request({
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
      })),
    ).toMatchObject({ allowed: true, reason: "user-initiated" });
  });

  it("denies a same-site request until the application trusts it", () => {
    const headers = {
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
    };

    expect(checkFetchMetadata(true, request(headers))).toMatchObject({
      allowed: false,
      reason: "same-site-denied",
    });
    expect(
      checkFetchMetadata({ allowSameSite: true }, request(headers)),
    ).toMatchObject({ allowed: true, reason: "same-site-trusted" });
  });

  it("denies a cross-site subresource request", () => {
    expect(
      checkFetchMetadata(true, request({
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      })),
    ).toEqual({
      allowed: false,
      reason: "cross-site-denied",
      vary: ["Sec-Fetch-Site", "Sec-Fetch-Mode"],
    });
  });

  it("allows a safe cross-site top-level navigation into the site", () => {
    expect(
      checkFetchMetadata(true, request({
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
      })),
    ).toEqual({
      allowed: true,
      reason: "top-level-navigation",
      vary: ["Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Dest"],
    });
  });

  it("denies a cross-site navigation that embeds the route in a document", () => {
    for (const destination of ["embed", "object"]) {
      expect(
        checkFetchMetadata(true, request({
          "sec-fetch-dest": destination,
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "cross-site",
        })),
      ).toMatchObject({ allowed: false, reason: "cross-site-denied" });
    }
  });

  it("denies a cross-site navigation that uses an unsafe method", () => {
    const check = checkFetchMetadata(
      true,
      request(
        {
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "cross-site",
        },
        { method: "POST" },
      ),
    );

    expect(check).toEqual({
      allowed: false,
      reason: "cross-site-denied",
      vary: ["Sec-Fetch-Site"],
    });
  });

  it("keeps navigation deniable through allowNavigation", () => {
    expect(
      checkFetchMetadata({ allowNavigation: false }, request({
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
      })),
    ).toEqual({
      allowed: false,
      reason: "cross-site-denied",
      vary: ["Sec-Fetch-Site"],
    });
  });

  it("allows a client that sends no Fetch Metadata headers", () => {
    expect(checkFetchMetadata(true, request({}))).toEqual({
      allowed: true,
      reason: "metadata-absent",
      vary: ["Sec-Fetch-Site"],
    });
  });

  it("denies an unknown site value the same way it denies a cross-site value", () => {
    expect(
      checkFetchMetadata(true, request({
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-galaxy",
      })),
    ).toMatchObject({ allowed: false, reason: "cross-site-denied" });
  });

  it("exempts a route that intentionally serves another site", () => {
    expect(
      checkFetchMetadata({ allowCrossSite: true }, request({
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
      })),
    ).toEqual({
      allowed: true,
      reason: "cross-site-exempt",
      vary: ["Sec-Fetch-Site"],
    });
  });

  it("exempts a listed cross-site destination and varies on it", () => {
    const policy = { allowedDestinations: ["image"] } as const;

    expect(
      checkFetchMetadata(policy, request({
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      })),
    ).toEqual({
      allowed: true,
      reason: "destination-exempt",
      vary: ["Sec-Fetch-Site", "Sec-Fetch-Dest"],
    });
    expect(
      checkFetchMetadata(policy, request({
        "sec-fetch-dest": "script",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      })),
    ).toEqual({
      allowed: false,
      reason: "cross-site-denied",
      vary: ["Sec-Fetch-Site", "Sec-Fetch-Dest", "Sec-Fetch-Mode"],
    });
  });

  it("exempts a CORS preflight and reads no Fetch Metadata field", () => {
    const preflight = new Request("https://app.example.com/reports", {
      headers: {
        "access-control-request-method": "POST",
        origin: "https://other.example",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
      },
      method: "OPTIONS",
    });

    expect(checkFetchMetadata(true, preflight, "OPTIONS")).toEqual({
      allowed: true,
      reason: "cors-preflight",
      vary: [],
    });
  });
});

describe("enforceFetchMetadataPolicy", () => {
  it("stays inactive when a route declares no policy", () => {
    expect(
      enforceFetchMetadataPolicy(undefined, request({
        "sec-fetch-site": "cross-site",
      }), "GET"),
    ).toEqual({ response: null, vary: [] });
    expect(
      enforceFetchMetadataPolicy(false, request({
        "sec-fetch-site": "cross-site",
      }), "GET"),
    ).toEqual({ response: null, vary: [] });
  });

  it("returns a 403 response that declares the consulted fields", async () => {
    const result = enforceFetchMetadataPolicy(
      true,
      request({
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "cross-site",
      }),
      "GET",
    );

    expect(result.response?.status).toBe(403);
    expect(result.response?.headers.get("vary")).toBe(
      "Sec-Fetch-Site, Sec-Fetch-Mode",
    );
    await expect(result.response?.text()).resolves.toBe(
      "Request blocked by the Fetch Metadata policy.",
    );
  });

  it("reports the fields to declare when it allows the request", () => {
    expect(
      enforceFetchMetadataPolicy(true, request({
        "sec-fetch-site": "same-origin",
      }), "GET"),
    ).toEqual({ response: null, vary: ["Sec-Fetch-Site"] });
  });
});

describe("applyFetchMetadataVary", () => {
  it("keeps an existing field and adds each new field once", () => {
    const response = applyFetchMetadataVary(
      new Response(null, { headers: { vary: "Origin, sec-fetch-site" } }),
      ["Sec-Fetch-Site", "Sec-Fetch-Mode", "Sec-Fetch-Mode"],
    );

    expect(response.headers.get("vary")).toBe(
      "Origin, sec-fetch-site, Sec-Fetch-Mode",
    );
  });

  it("leaves a response alone when the decision read no field", () => {
    const response = applyFetchMetadataVary(new Response(null), []);

    expect(response.headers.get("vary")).toBeNull();
  });

  it("keeps a wildcard Vary header unchanged", () => {
    const response = applyFetchMetadataVary(
      new Response(null, { headers: { vary: "*" } }),
      ["Sec-Fetch-Site"],
    );

    expect(response.headers.get("vary")).toBe("*");
  });
});
