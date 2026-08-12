const HTML_MEDIA_TYPES = ["text/html", "application/xhtml+xml"];

type MediaRange = {
  quality: number;
  type: string;
};

// On an unmatched path there is no route to consult, so `accept` is the only
// signal available. The rule is deliberately strict: only an explicit HTML
// range counts. A missing header, a malformed one, or a bare `*/*` gets
// problem+json.
//
// Failing toward the machine format is the safe direction. A browser always
// sends an explicit `text/html`, so it keeps getting the document, while an
// API client that sends `*/*` or nothing never receives a page of markup it
// has no way to parse.
export function prefersHtmlDocument(request: Request) {
  return acceptsHtmlDocument(request.headers.get("accept"));
}

export function acceptsHtmlDocument(header: string | null) {
  if (!header) {
    return false;
  }

  return parseAcceptHeader(header).some(
    (range) => range.quality > 0 && HTML_MEDIA_TYPES.includes(range.type),
  );
}

function parseAcceptHeader(header: string): MediaRange[] {
  return header
    .split(",")
    .flatMap((entry) => {
      const [type, ...parameters] = entry.split(";");
      const normalizedType = type.trim().toLowerCase();

      if (!normalizedType) {
        return [];
      }

      return [
        {
          quality: parseQuality(parameters),
          type: normalizedType,
        },
      ];
    });
}

function parseQuality(parameters: string[]) {
  for (const parameter of parameters) {
    const [name, value] = parameter.split("=");

    if (name?.trim().toLowerCase() !== "q") {
      continue;
    }

    const quality = Number.parseFloat(value ?? "");

    // A `q` that does not parse is a malformed header rather than a request to
    // exclude the type, so it falls back to the default weight.
    return Number.isNaN(quality) ? 1 : quality;
  }

  return 1;
}
