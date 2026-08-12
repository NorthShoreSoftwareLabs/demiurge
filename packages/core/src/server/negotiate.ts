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
// The machine format is the safe default. A browser sends an explicit
// `text/html` value and receives the document. An API client that sends `*/*`
// or nothing receives a machine-readable response.
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

    // A `q` that does not parse is a malformed header. It is not a request to
    // exclude the type. Therefore, the function uses the default weight.
    return Number.isNaN(quality) ? 1 : quality;
  }

  return 1;
}
