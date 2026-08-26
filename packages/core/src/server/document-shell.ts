import { renderDocumentShell } from "../document/render";
import type { ScriptTag } from "../document/scripts";
import type { LoadedRouteMatch } from "../router";
import { resolveDocumentLocale, type SsrRenderOptions } from "./ssr";

// A streaming render sends the document head before the body exists. A
// transform that rewrites the document therefore needs a placeholder where the
// streamed body will go, and it has to leave that placeholder in place.
export const STREAM_ROOT_MARKER =
  '<template data-demiurge-stream-root=""></template>';

export type DocumentShell = {
  prefix: string;
  suffix: string;
};

export async function createDocumentShell(
  match: LoadedRouteMatch,
  options: SsrRenderOptions & { scripts?: ScriptTag[] },
): Promise<DocumentShell> {
  const documentLocale = resolveDocumentLocale(options);
  const shell = renderDocumentShell({
    body: { data: match.data, locale: options.locale, navigation: options.navigation },
    dir: documentLocale.dir,
    entrySrc: options.clientEntry,
    lang: documentLocale.lang,
    links: match.links,
    metadata: match.metadata,
    nonce: options.nonce,
    scripts: options.scripts ?? match.scripts,
    styles: options.styles,
    title: options.title,
  });

  if (!options.transformDocument) {
    return shell;
  }

  const transformed = await options.transformDocument(
    `${shell.prefix}${STREAM_ROOT_MARKER}${shell.suffix}`,
  );
  const markerIndex = transformed.indexOf(STREAM_ROOT_MARKER);

  if (
    markerIndex === -1 ||
    transformed.indexOf(
      STREAM_ROOT_MARKER,
      markerIndex + STREAM_ROOT_MARKER.length,
    ) !== -1
  ) {
    throw new Error(
      "Demiurge streaming document transform must preserve the root marker exactly once.",
    );
  }

  return {
    prefix: transformed.slice(0, markerIndex),
    suffix: transformed.slice(markerIndex + STREAM_ROOT_MARKER.length),
  };
}
