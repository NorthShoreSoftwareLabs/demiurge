import type {
  HttpRouteContext,
  MaybePromise,
  RawResponseCapability,
} from "./types";

export type WebhookHmacEncoding = "base64" | "hex";
export type WebhookHmacAlgorithm = "SHA-256" | "SHA-384" | "SHA-512";

export type WebhookHmacContext = HttpRouteContext & {
  rawBody: string;
};

export type WebhookHmacOptions = {
  algorithm?: WebhookHmacAlgorithm;
  encoding?: WebhookHmacEncoding;
  handler: (context: WebhookHmacContext) => MaybePromise<Response>;
  header?: string;
  secret: string;
};

export const webhook = {
  hmac(options: WebhookHmacOptions) {
    return {
      kind: "response",
      response: async (context) => {
        const rawBody = await context.request.text();
        const signature = context.request.headers.get(
          options.header ?? "x-webhook-signature",
        );

        if (!signature) {
          return new Response("Missing webhook signature.", {
            status: 401,
          });
        }

        const expectedSignature = await createHmacSignature(rawBody, options);

        if (!constantTimeEqual(normalizeSignature(signature), expectedSignature)) {
          return new Response("Invalid webhook signature.", {
            status: 401,
          });
        }

        return await options.handler({
          ...context,
          rawBody,
        });
      },
      security: {
        csrf: false,
      },
    } satisfies RawResponseCapability;
  },
};

async function createHmacSignature(
  rawBody: string,
  options: WebhookHmacOptions,
) {
  const algorithm = options.algorithm ?? "SHA-256";
  const encoding = options.encoding ?? "hex";
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(options.secret),
    {
      hash: algorithm,
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const bytes = new Uint8Array(signature);

  return encoding === "base64" ? toBase64(bytes) : toHex(bytes);
}

function normalizeSignature(signature: string) {
  const separator = signature.indexOf("=");

  if (separator === -1) {
    return signature.trim();
  }

  return signature.slice(separator + 1).trim();
}

function constantTimeEqual(left: string, right: string) {
  let diff = left.length ^ right.length;
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  if (typeof btoa === "function") {
    return btoa(binary);
  }

  return Buffer.from(binary, "binary").toString("base64");
}
