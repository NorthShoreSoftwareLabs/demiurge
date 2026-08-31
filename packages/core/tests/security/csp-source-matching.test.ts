// Coverage for the CSP source-list matching helpers in verification.ts
// (`cspSourceListAllows` / `cspSourceMatchesOrigin`). Those functions are not
// exported, so every case here drives them through the public
// `validateRouteModules` entry point: a script declares a runtime `needs`
// origin, the route's document policy declares a `connectSrc` list, and we
// assert whether verification accepts or rejects the combination.
import { describe, expect, it } from "vitest";
import {
  defineRoutePolicy,
  defineScripts,
  page,
  script,
  security,
} from "@demiurgejs/core";
import { validateRouteModules } from "../../src/security/verification";

function View() {
  return null;
}

function modulesNeedingConnect(
  connectSrc: readonly string[] | false,
  neededOrigin: string,
) {
  return {
    "./routes/@policy.ts": {
      policy: defineRoutePolicy({
        document: security.static({
        csp: {
          connectSrc,
          scriptSrc: ["'self'", "https://widget.example.com"],
        },
      }),
      }),
    },
    "./routes/index.tsx": {
      GET: page({ render: { mode: "ssr" }, view: View }),
      scripts: defineScripts([
        script({
          needs: { connect: [neededOrigin] },
          src: "https://widget.example.com/widget.js",
        }),
      ]),
    },
  };
}

describe("cspSourceListAllows / cspSourceMatchesOrigin", () => {
  it("rejects every origin when the directive is 'none', even one otherwise allowed", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(["'none'"], "https://api.example.com"),
      )
    ).toThrow(
      /needs connect-src https:\/\/api\.example\.com, which the effective policy does not allow/,
    );
  });

  it("allows any origin when the directive contains the * wildcard", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(["*"], "https://anything.example.net"),
      )
    ).not.toThrow();
  });

  it("allows a scheme-only source to match any origin using that scheme", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(["https:"], "https://api.example.com"),
      )
    ).not.toThrow();
  });

  it("rejects a scheme-only source when the required origin uses a different scheme", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(["https:"], "http://api.example.com"),
      )
    ).toThrow(
      /needs connect-src http:\/\/api\.example\.com, which the effective policy does not allow/,
    );
  });

  it("allows an exact origin match", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(
          ["https://api.example.com"],
          "https://api.example.com",
        ),
      )
    ).not.toThrow();
  });

  it("rejects an origin that merely shares a scheme and port with an exact source", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(
          ["https://api.example.com"],
          "https://other.example.com",
        ),
      )
    ).toThrow(
      /needs connect-src https:\/\/other\.example\.com, which the effective policy does not allow/,
    );
  });

  describe("wildcard-subdomain sources (*.example.com)", () => {
    it("allows a genuine subdomain of the wildcard host", () => {
      expect(() =>
        validateRouteModules(
          modulesNeedingConnect(
            ["https://*.example.com"],
            "https://foo.example.com",
          ),
        )
      ).not.toThrow();
    });

    it("allows a nested subdomain of the wildcard host", () => {
      expect(() =>
        validateRouteModules(
          modulesNeedingConnect(
            ["https://*.example.com"],
            "https://a.b.example.com",
          ),
        )
      ).not.toThrow();
    });

    it("rejects the bare apex domain, which the wildcard does not cover", () => {
      expect(() =>
        validateRouteModules(
          modulesNeedingConnect(
            ["https://*.example.com"],
            "https://example.com",
          ),
        )
      ).toThrow(
        /needs connect-src https:\/\/example\.com, which the effective policy does not allow/,
      );
    });

    // SECURITY: this is the case that matters most for a wildcard-subdomain
    // matcher. A naive `hostname.endsWith(suffix)` check without requiring
    // the leading dot would let "evil-example.com" pass for pattern
    // "*.example.com", because the string "example.com" is a suffix of
    // "evil-example.com". The implementation matches against
    // ".example.com" (including the dot), so this must be rejected.
    it("rejects a look-alike host that merely ends with the same characters (not a real subdomain)", () => {
      expect(() =>
        validateRouteModules(
          modulesNeedingConnect(
            ["https://*.example.com"],
            "https://evil-example.com",
          ),
        )
      ).toThrow(
        /needs connect-src https:\/\/evil-example\.com, which the effective policy does not allow/,
      );
    });

    it("rejects a host that contains the suffix as a substring but is not a subdomain", () => {
      expect(() =>
        validateRouteModules(
          modulesNeedingConnect(
            ["https://*.example.com"],
            "https://notexample.com",
          ),
        )
      ).toThrow(
        /needs connect-src https:\/\/notexample\.com, which the effective policy does not allow/,
      );
    });

    it("rejects a subdomain match when the port differs", () => {
      expect(() =>
        validateRouteModules(
          modulesNeedingConnect(
            ["https://*.example.com:8443"],
            "https://foo.example.com",
          ),
        )
      ).toThrow(
        /needs connect-src https:\/\/foo\.example\.com, which the effective policy does not allow/,
      );
    });
  });

  it("rejects a quoted keyword requirement that is not explicitly listed", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(
          ["https://api.example.com"],
          // needs.connect entries are ordinarily URLs, but the matcher must
          // not accidentally treat a quoted CSP keyword as a matchable
          // origin (cspSourceMatchesOrigin short-circuits on a leading `'`).
          "'unsafe-inline'",
        ),
      )
    ).toThrow(
      /needs connect-src 'unsafe-inline', which the effective policy does not allow/,
    );
  });

  it("allows a quoted keyword requirement when it is explicitly listed in the source list", () => {
    expect(() =>
      validateRouteModules(
        modulesNeedingConnect(
          ["https://api.example.com", "'unsafe-inline'"],
          "'unsafe-inline'",
        ),
      )
    ).not.toThrow();
  });
});
