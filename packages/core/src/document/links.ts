import type { HttpRouteContext, MaybePromise } from "../route";
import type { LinkTag } from "./metadata";

export type LinkContribution =
  | readonly LinkTag[]
  | ((context: HttpRouteContext) => MaybePromise<readonly LinkTag[]>);

export type PreloadOptions = {
  as: string;
  crossOrigin?: "anonymous" | "use-credentials";
  type?: string;
};

export type PreconnectOptions = {
  crossOrigin?: "anonymous" | "use-credentials";
};

export function defineLinks(contribution: LinkContribution) {
  return contribution;
}

export function preconnect(
  href: string,
  options: PreconnectOptions = {},
): LinkTag {
  return {
    ...options,
    href,
    kind: "link",
    rel: "preconnect",
  };
}

export function preload(href: string, options: PreloadOptions): LinkTag {
  return {
    ...options,
    href,
    kind: "link",
    rel: "preload",
  };
}

export function modulePreload(href: string): LinkTag {
  return {
    href,
    kind: "link",
    rel: "modulepreload",
  };
}

export async function resolveLinks(
  contributions: Array<LinkContribution | false | undefined>,
  context: HttpRouteContext,
) {
  const links: LinkTag[] = [];

  for (const contribution of contributions) {
    if (!contribution) {
      continue;
    }

    const resolved =
      typeof contribution === "function"
        ? await contribution(context)
        : contribution;

    links.push(...resolved);
  }

  return dedupeLinks(links).sort(compareLinks);
}

function dedupeLinks(links: LinkTag[]) {
  const deduped = new Map<string, LinkTag>();

  for (const linkTag of links) {
    deduped.set(linkKey(linkTag), {
      ...deduped.get(linkKey(linkTag)),
      ...linkTag,
    });
  }

  return [...deduped.values()];
}

function linkKey(linkTag: LinkTag) {
  return [
    linkTag.rel,
    linkTag.href,
    linkTag.as ?? "",
    linkTag.type ?? "",
    linkTag.crossOrigin ?? "",
  ].join("\0");
}

function compareLinks(left: LinkTag, right: LinkTag) {
  return linkRelOrder(left.rel) - linkRelOrder(right.rel) ||
    left.href.localeCompare(right.href);
}

function linkRelOrder(rel: string) {
  if (rel === "preconnect") {
    return 0;
  }

  if (rel === "preload") {
    return 1;
  }

  if (rel === "modulepreload") {
    return 2;
  }

  return 3;
}
