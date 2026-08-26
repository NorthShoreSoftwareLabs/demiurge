// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  link,
  meta,
  resolveMetadata,
  script,
  structuredData,
} from "@demiurgejs/core";
import {
  applyNavigationDocument,
  createNavigationDocument,
  DOCUMENT_CONTRIBUTION_ATTRIBUTE,
} from "../../src/document";

describe("navigation document contributions", () => {
  beforeEach(() => {
    document.documentElement.lang = "en";
    document.documentElement.dir = "ltr";
    document.head.innerHTML = `
      <meta charset="utf-8">
      <title>Previous</title>
      <meta ${DOCUMENT_CONTRIBUTION_ATTRIBUTE} name="description" content="Previous">
      <script nonce="document-nonce" src="/client.js"></script>
      <script ${DOCUMENT_CONTRIBUTION_ATTRIBUTE} data-demiurge-script-strategy="afterInteractive" src="/shared.js"></script>
    `;
  });

  it("updates document language and direction", () => {
    applyNavigationDocument(createNavigationDocument({
      dir: "rtl",
      lang: "ar",
      metadata: resolveMetadata(),
    }));

    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
  });

  it("preserves document attributes when a contribution omits them", () => {
    applyNavigationDocument(createNavigationDocument({
      metadata: resolveMetadata(),
    }));

    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("replaces route-owned metadata and links", () => {
    applyNavigationDocument(createNavigationDocument({
      links: [link({ href: "/next.css", rel: "stylesheet" })],
      metadata: resolveMetadata({
        canonical: "/next",
        custom: [meta({ content: "article", property: "og:type" })],
        description: "Next",
        robots: { follow: false, index: true },
        structuredData: [structuredData({ name: "Next" })],
        title: "Next title",
      }),
    }));

    expect(document.title).toBe("Next title");
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute("content"))
      .toBe("Next");
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"))
      .toBe("/next");
    expect(document.head.querySelector('link[href="/next.css"]')).toBeTruthy();
    expect(document.head.querySelector('meta[property="og:type"]')?.getAttribute("content"))
      .toBe("article");
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content"))
      .toBe("index, nofollow");
    const structured = document.head.querySelector<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    );
    expect(structured?.textContent).toBe('{"name":"Next"}');
    expect(structured?.nonce).toBe("document-nonce");
  });

  it("reuses matching scripts and removes route-only scripts", () => {
    const shared = document.head.querySelector<HTMLScriptElement>(
      `script[${DOCUMENT_CONTRIBUTION_ATTRIBUTE}]`,
    );
    const contribution = createNavigationDocument({
      metadata: resolveMetadata({ title: "Scripts" }),
      scripts: [
        script({ src: "/shared.js" }),
        script({ src: "/next.js", strategy: "module" }),
      ],
    });

    applyNavigationDocument(contribution);

    expect(document.head.querySelector('script[src="/shared.js"]')).toBe(shared);
    const next = document.head.querySelector<HTMLScriptElement>('script[src="/next.js"]');
    expect(next?.type).toBe("module");
    expect(next?.nonce).toBe("document-nonce");

    applyNavigationDocument(createNavigationDocument({
      metadata: resolveMetadata({ title: "No scripts" }),
    }));

    expect(document.head.querySelector('script[src="/shared.js"]')).toBeNull();
    expect(document.head.querySelector('script[src="/next.js"]')).toBeNull();
    expect(document.head.querySelector('script[src="/client.js"]')).toBeTruthy();
  });

  it("does not serialize script policy or nonce fields", () => {
    const contribution = createNavigationDocument({
      metadata: resolveMetadata(),
      scripts: [script({
        needs: { connect: ["https://api.example.test"] },
        nonce: "response-nonce",
        purpose: "server audit value",
        src: "/safe.js",
      })],
    });

    expect(contribution.scripts).toEqual([{
      async: undefined,
      crossOrigin: undefined,
      dataApi: undefined,
      dataDomain: undefined,
      defer: undefined,
      id: undefined,
      integrity: undefined,
      kind: "script",
      referrerPolicy: undefined,
      src: "/safe.js",
      strategy: "afterInteractive",
      type: undefined,
    }]);
  });

  it("applies complete link and script fields to a target document", () => {
    const target = document.implementation.createHTMLDocument("Target");
    const legacyModule = target.createElement("script");
    legacyModule.setAttribute(DOCUMENT_CONTRIBUTION_ATTRIBUTE, "");
    legacyModule.src = "/legacy.js";
    legacyModule.type = "module";
    target.head.append(legacyModule);

    applyNavigationDocument(createNavigationDocument({
      links: [link({
        as: "style",
        crossOrigin: "use-credentials",
        href: "/full.css",
        hrefLang: "en",
        rel: "alternate",
        type: "text/css",
      })],
      metadata: resolveMetadata(),
      scripts: [
        script({ src: "/legacy.js", strategy: "module" }),
        script({
          async: true,
          crossOrigin: "anonymous",
          dataApi: "/collect",
          dataDomain: "example.test",
          defer: true,
          id: "complete-script",
          integrity: "sha384-complete",
          referrerPolicy: "no-referrer",
          src: "/complete.js",
          type: "text/javascript",
        }),
        script({
          id: "idle-script",
          src: "/idle.js",
          strategy: "idle",
          type: "module",
        }),
      ],
    }), target);

    expect(target.querySelector('script[src="/legacy.js"]')).toBe(legacyModule);
    const complete = target.querySelector<HTMLScriptElement>("#complete-script");
    expect(complete?.async).toBe(true);
    expect(complete?.defer).toBe(true);
    expect(complete?.crossOrigin).toBe("anonymous");
    expect(complete?.dataset.api).toBe("/collect");
    expect(complete?.dataset.domain).toBe("example.test");
    expect(complete?.integrity).toBe("sha384-complete");
    expect(complete?.referrerPolicy).toBe("no-referrer");
    expect(target.querySelector("#idle-script")?.getAttribute("data-demiurge-script-type"))
      .toBe("module");

    const fullLink = target.querySelector<HTMLLinkElement>('link[href$="/full.css"]');
    expect(fullLink?.as).toBe("style");
    expect(fullLink?.crossOrigin).toBe("use-credentials");
    expect(fullLink?.hreflang).toBe("en");
    expect(fullLink?.type).toBe("text/css");
  });
});
