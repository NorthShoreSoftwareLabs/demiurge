import type {
  HttpRouteContext,
  MaybePromise,
  RawResponseCapability,
} from "./types";

export type WebhookHmacEncoding = "base64" | "hex";
export type WebhookHmacAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

export type WebhookHmacContext = HttpRouteContext & {
  rawBody: Uint8Array;
  text: () => string;
};

export type WebhookHmacOptions = {
  algorithm?: WebhookHmacAlgorithm;
  encoding?: WebhookHmacEncoding;
  handler: (context: WebhookHmacContext) => MaybePromise<Response>;
  header?: string;
  prefix?: false | string;
  secret: string;
};

export const webhook = {
  hmac(options: WebhookHmacOptions) {
    return {
      kind: "response",
      response: async (context) => {
        const rawBody = new Uint8Array(await context.request.arrayBuffer());
        const signature = context.request.headers.get(
          options.header ?? "x-webhook-signature",
        );

        if (!signature) {
          return new Response("Missing webhook signature.", {
            status: 401,
          });
        }

        if (!(await verifyHmacSignature(rawBody, signature, options))) {
          return new Response("Invalid webhook signature.", {
            status: 401,
          });
        }

        return await options.handler({
          ...context,
          rawBody,
          text: () => new TextDecoder().decode(rawBody),
        });
      },
      security: {
        csrf: false,
      },
    } satisfies RawResponseCapability;
  },
};

async function verifyHmacSignature(
  rawBody: Uint8Array,
  suppliedSignature: string,
  options: WebhookHmacOptions,
) {
  const algorithm = options.algorithm ?? "SHA-256";
  const encoding = options.encoding ?? "hex";
  const normalized = normalizeSignature(
    suppliedSignature,
    algorithm,
    options.prefix,
  );
  const signature = decodeSignature(normalized, encoding);

  if (!signature) {
    return false;
  }

  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.secret),
    {
      hash: algorithm,
      name: "HMAC",
    },
    false,
    ["verify"],
  );
  return await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    Uint8Array.from(rawBody).buffer,
  );
}

function normalizeSignature(
  signature: string,
  algorithm: WebhookHmacAlgorithm,
  configuredPrefix: false | string | undefined,
) {
  const trimmed = signature.trim();
  const prefix =
    configuredPrefix === undefined
      ? `${algorithm.toLowerCase().replace("-", "")}=`
      : configuredPrefix;

  if (prefix !== false && trimmed.startsWith(prefix)) {
    return trimmed.slice(prefix.length).trim();
  }

  return trimmed;
}

function decodeSignature(value: string, encoding: WebhookHmacEncoding) {
  if (encoding === "hex") {
    if (!/^(?:[0-9a-f]{2})+$/i.test(value)) {
      return null;
    }

    return Uint8Array.from(value.match(/.{2}/g) ?? [], (pair) =>
      Number.parseInt(pair, 16),
    );
  }

  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    return null;
  }

  try {
    const binary =
      typeof atob === "function"
        ? atob(value)
        : Buffer.from(value, "base64").toString("binary");

    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}
