export const HTTP_ERROR_STATUSES = [
  400,
  401,
  402,
  403,
  404,
  405,
  406,
  407,
  408,
  409,
  410,
  411,
  412,
  413,
  414,
  415,
  416,
  417,
  418,
  421,
  422,
  423,
  424,
  425,
  426,
  428,
  429,
  431,
  451,
  500,
  501,
  502,
  503,
  504,
  505,
  506,
  507,
  508,
  510,
  511,
] as const;

export type HttpErrorStatus = (typeof HTTP_ERROR_STATUSES)[number];

export type HttpErrorDetails = {
  detail?: string;
  title?: string;
  type?: string;
  [extension: string]: unknown;
};

export type HttpErrorInit = {
  cause?: unknown;
  headers?: HeadersInit;
};

const statusTitles: Record<HttpErrorStatus, string> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a Teapot",
  421: "Misdirected Request",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

const statusSet = new Set<number>(HTTP_ERROR_STATUSES);

export class HttpError extends Error {
  readonly detail?: string;
  readonly extensions: Readonly<Record<string, unknown>>;
  readonly headers: Headers;
  readonly status: HttpErrorStatus;
  readonly title: string;
  readonly type: string;

  constructor(
    status: HttpErrorStatus,
    details: string | HttpErrorDetails = {},
    init: HttpErrorInit = {},
  ) {
    assertHttpErrorStatus(status);

    const normalized = typeof details === "string"
      ? { detail: details }
      : details;
    const {
      detail,
      title = statusTitles[status],
      type = "about:blank",
      ...extensions
    } = normalized;

    super(detail ?? title, { cause: init.cause });
    this.name = "HttpError";
    this.detail = detail;
    this.extensions = Object.freeze({ ...extensions });
    this.headers = new Headers(init.headers);
    this.status = status;
    this.title = title;
    this.type = type;
  }
}

export function httpError(
  status: HttpErrorStatus,
  details?: string | HttpErrorDetails,
  init?: HttpErrorInit,
) {
  return new HttpError(status, details, init);
}

export function isHttpError(error: unknown): error is HttpError {
  return error instanceof HttpError;
}

function assertHttpErrorStatus(status: number): asserts status is HttpErrorStatus {
  if (!statusSet.has(status)) {
    throw new RangeError(
      `HTTP error status must be a standard 4xx or 5xx status; received ${JSON.stringify(status)}.`,
    );
  }
}
