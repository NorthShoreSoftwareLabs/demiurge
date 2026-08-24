import {
  createSecureCookie,
  secureCookieName,
  type CookieSameSite,
  type CookieScope,
} from "./cookies";
import { parseCookieHeader } from "./csrf";
import type { SessionData, SessionRecord } from "./session-store";

const defaultAbsoluteExpirationMs = 7 * 24 * 60 * 60 * 1000;
const defaultIdleExpirationMs = 24 * 60 * 60 * 1000;
const sessionIdentifierBytes = 32;

export type SessionCookieKey = {
  id: string;
  value: Uint8Array;
};

export type SessionCookieDefinition = {
  domain?: string;
  httpOnly?: boolean;
  name?: string;
  path?: string;
  sameSite?: CookieSameSite;
  scope?: CookieScope;
  secure?: boolean;
};

export type CookieSessionOptions = {
  absoluteExpirationMs?: number;
  cookie?: SessionCookieDefinition;
  idleExpirationMs?: false | number;
  keys: readonly SessionCookieKey[];
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  renewal?: boolean;
};

export type CookieSessionCreateOptions = {
  absoluteExpirationMs?: number;
  idleExpirationMs?: false | number;
};

export type CookieSession<TData extends SessionData> = {
  commit: () => Promise<readonly string[]>;
  create: (
    data: TData,
    options?: CookieSessionCreateOptions,
  ) => SessionRecord<TData>;
  destroy: () => void;
  get: () => SessionRecord<TData> | undefined;
  rotate: (data?: TData) => SessionRecord<TData>;
  update: (data: TData) => SessionRecord<TData>;
};

export type CookieSessionManager<TData extends SessionData> = {
  cookieName: string;
  open: (request: Request) => Promise<CookieSession<TData>>;
};

type DecodedSession<TData extends SessionData> = {
  currentKey: boolean;
  record: SessionRecord<TData>;
};

type SessionCodec<TData extends SessionData> = {
  decode: (value: string) => Promise<DecodedSession<TData> | undefined>;
  encode: (record: SessionRecord<TData>) => Promise<string>;
};

export function createSignedCookieSession<
  TData extends SessionData,
>(options: CookieSessionOptions): CookieSessionManager<TData> {
  const resolved = resolveOptions(options);
  return createCookieSessionManager(resolved, signedCodec<TData>(resolved.keys));
}

export function createEncryptedCookieSession<
  TData extends SessionData,
>(options: CookieSessionOptions): CookieSessionManager<TData> {
  const resolved = resolveOptions(options);

  for (const key of resolved.keys) {
    if (key.value.byteLength !== 32) {
      throw new Error(
        `Demiurge encrypted cookie session key ${JSON.stringify(key.id)} must contain exactly 32 bytes for AES-256-GCM.`,
      );
    }
  }

  return createCookieSessionManager(
    resolved,
    encryptedCodec<TData>(resolved.keys, resolved.randomBytes),
  );
}

type ResolvedOptions = {
  absoluteExpirationMs: number;
  cookie: Required<Pick<SessionCookieDefinition, "name">> &
    Omit<SessionCookieDefinition, "name">;
  idleExpirationMs: false | number;
  keys: readonly SessionCookieKey[];
  now: () => number;
  randomBytes: (length: number) => Uint8Array;
  renewal: boolean;
};

function createCookieSessionManager<TData extends SessionData>(
  options: ResolvedOptions,
  codec: SessionCodec<TData>,
): CookieSessionManager<TData> {
  const cookieName = secureCookieName(
    options.cookie.name,
    options.cookie.scope ?? "host",
  );

  return {
    cookieName,
    async open(request) {
      const rawCookie = parseCookieHeader(request.headers.get("cookie") ?? "")
        .get(cookieName);
      const now = options.now();
      const decoded = rawCookie ? await codec.decode(rawCookie) : undefined;
      let record = decoded?.record;
      let destroyCookie = Boolean(rawCookie && !decoded);
      let dirty = Boolean(decoded && !decoded.currentKey);

      if (record && isExpired(record, now)) {
        record = undefined;
        destroyCookie = true;
        dirty = false;
      } else if (
        record &&
        options.renewal &&
        options.idleExpirationMs !== false &&
        record.idleExpiresAt !== undefined &&
        record.idleExpiresAt - now <= options.idleExpirationMs / 4
      ) {
        record = {
          ...record,
          idleExpiresAt: Math.min(
            record.expiresAt,
            now + options.idleExpirationMs,
          ),
          version: record.version + 1,
        };
        dirty = true;
      }

      const requireRecord = () => {
        if (!record) {
          throw new Error(
            "Demiurge cannot change a session that does not exist. Create the session first.",
          );
        }

        return record;
      };

      const setRecord = (next: SessionRecord<TData>) => {
        record = cloneRecord(next);
        destroyCookie = false;
        dirty = true;
        return cloneRecord(next);
      };

      return {
        async commit() {
          if (destroyCookie) {
            return [destroyedCookie(options.cookie)];
          }

          if (!record || !dirty) {
            return [];
          }

          return [createSecureCookie({
            ...options.cookie,
            expires: new Date(record.expiresAt),
            value: await codec.encode(record),
          })];
        },
        create(data, createOptions = {}) {
          if (record) {
            throw new Error(
              "Demiurge cannot create a session when one already exists. Rotate or update the current session.",
            );
          }

          const createdAt = options.now();
          const absoluteExpirationMs = validateLifetime(
            "absoluteExpirationMs",
            createOptions.absoluteExpirationMs ?? options.absoluteExpirationMs,
          );
          const idleExpirationMs = createOptions.idleExpirationMs === undefined
            ? options.idleExpirationMs
            : validateIdleLifetime(createOptions.idleExpirationMs);
          const expiresAt = createdAt + absoluteExpirationMs;

          return setRecord({
            createdAt,
            data: cloneData(data),
            expiresAt,
            id: randomIdentifier(options.randomBytes),
            ...(idleExpirationMs === false
              ? {}
              : {
                idleExpiresAt: Math.min(
                  expiresAt,
                  createdAt + idleExpirationMs,
                ),
              }),
            version: 0,
          });
        },
        destroy() {
          record = undefined;
          destroyCookie = true;
          dirty = false;
        },
        get() {
          return record ? cloneRecord(record) : undefined;
        },
        rotate(data) {
          const current = requireRecord();
          return setRecord({
            ...current,
            data: data === undefined ? current.data : cloneData(data),
            id: randomIdentifier(options.randomBytes),
            version: current.version + 1,
          });
        },
        update(data) {
          const current = requireRecord();
          return setRecord({
            ...current,
            data: cloneData(data),
            version: current.version + 1,
          });
        },
      };
    },
  };
}

function resolveOptions(options: CookieSessionOptions): ResolvedOptions {
  const keys = validateKeys(options.keys);
  const absoluteExpirationMs = validateLifetime(
    "absoluteExpirationMs",
    options.absoluteExpirationMs ?? defaultAbsoluteExpirationMs,
  );
  const idleExpirationMs = validateIdleLifetime(
    options.idleExpirationMs ?? defaultIdleExpirationMs,
  );

  return {
    absoluteExpirationMs,
    cookie: { ...options.cookie, name: options.cookie?.name ?? "session" },
    idleExpirationMs,
    keys,
    now: options.now ?? Date.now,
    randomBytes: options.randomBytes ?? secureRandomBytes,
    renewal: options.renewal ?? true,
  };
}

function validateKeys(keys: readonly SessionCookieKey[]) {
  if (keys.length === 0) {
    throw new Error(
      "Demiurge cookie sessions require at least one key. Put the current key first.",
    );
  }

  const identifiers = new Set<string>();

  for (const key of keys) {
    if (!/^[A-Za-z0-9_-]+$/.test(key.id)) {
      throw new Error(
        "Demiurge cookie session key identifiers can use only letters, digits, underscores, and hyphens.",
      );
    }

    if (identifiers.has(key.id)) {
      throw new Error(
        `Demiurge cookie session key identifier ${JSON.stringify(key.id)} is not unique.`,
      );
    }

    if (key.value.byteLength < 32) {
      throw new Error(
        `Demiurge cookie session key ${JSON.stringify(key.id)} must contain at least 32 bytes.`,
      );
    }

    identifiers.add(key.id);
  }

  return [...keys];
}

function validateLifetime(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Demiurge cookie session ${name} must be a positive whole number of milliseconds.`,
    );
  }

  return value;
}

function validateIdleLifetime(value: false | number) {
  return value === false ? false : validateLifetime("idleExpirationMs", value);
}

function signedCodec<TData extends SessionData>(
  keys: readonly SessionCookieKey[],
): SessionCodec<TData> {
  return {
    async decode(value) {
      const parts = value.split(".");

      if (parts.length !== 4 || parts[0] !== "s1") {
        return undefined;
      }

      const keyIndex = keys.findIndex((key) => key.id === parts[1]);
      const key = keys[keyIndex];
      const payload = decodeBase64Url(parts[2]);
      const signature = decodeBase64Url(parts[3]);

      if (!key || !payload || !signature) {
        return undefined;
      }

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(key.value),
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["verify"],
      );
      const valid = await crypto.subtle.verify(
        "HMAC",
        cryptoKey,
        toArrayBuffer(signature),
        toArrayBuffer(encodeText(`s1.${key.id}.${parts[2]}`)),
      );

      if (!valid) {
        return undefined;
      }

      const record = parseRecord<TData>(payload);
      return record ? { currentKey: keyIndex === 0, record } : undefined;
    },
    async encode(record) {
      const key = keys[0];
      const payload = encodeBase64Url(encodeText(JSON.stringify(record)));
      const unsigned = `s1.${key.id}.${payload}`;
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        toArrayBuffer(key.value),
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        toArrayBuffer(encodeText(unsigned)),
      );
      return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
    },
  };
}

function encryptedCodec<TData extends SessionData>(
  keys: readonly SessionCookieKey[],
  randomBytes: (length: number) => Uint8Array,
): SessionCodec<TData> {
  return {
    async decode(value) {
      const parts = value.split(".");

      if (parts.length !== 4 || parts[0] !== "e1") {
        return undefined;
      }

      const keyIndex = keys.findIndex((key) => key.id === parts[1]);
      const key = keys[keyIndex];
      const nonce = decodeBase64Url(parts[2]);
      const ciphertext = decodeBase64Url(parts[3]);

      if (!key || nonce?.byteLength !== 12 || !ciphertext) {
        return undefined;
      }

      try {
        const cryptoKey = await importEncryptionKey(key);
        const plaintext = await crypto.subtle.decrypt(
          {
            additionalData: toArrayBuffer(encodeText(`e1.${key.id}`)),
            iv: toArrayBuffer(nonce),
            name: "AES-GCM",
          },
          cryptoKey,
          toArrayBuffer(ciphertext),
        );
        const record = parseRecord<TData>(new Uint8Array(plaintext));
        return record ? { currentKey: keyIndex === 0, record } : undefined;
      } catch {
        return undefined;
      }
    },
    async encode(record) {
      const key = keys[0];
      const nonce = randomBytes(12);

      if (nonce.byteLength !== 12) {
        throw new Error(
          "Demiurge cookie session randomBytes returned an incorrect byte count.",
        );
      }

      const cryptoKey = await importEncryptionKey(key);
      const ciphertext = await crypto.subtle.encrypt(
        {
          additionalData: toArrayBuffer(encodeText(`e1.${key.id}`)),
          iv: toArrayBuffer(nonce),
          name: "AES-GCM",
        },
        cryptoKey,
        toArrayBuffer(encodeText(JSON.stringify(record))),
      );
      return `e1.${key.id}.${encodeBase64Url(nonce)}.${encodeBase64Url(new Uint8Array(ciphertext))}`;
    },
  };
}

async function importEncryptionKey(key: SessionCookieKey) {
  return await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(key.value),
    "AES-GCM",
    false,
    ["decrypt", "encrypt"],
  );
}

function parseRecord<TData extends SessionData>(
  bytes: Uint8Array,
): SessionRecord<TData> | undefined {
  try {
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

    if (
      !isObject(value) ||
      !isSafeTimestamp(value.createdAt) ||
      !isSafeTimestamp(value.expiresAt) ||
      typeof value.id !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.id) ||
      !isNonNegativeInteger(value.version) ||
      (value.idleExpiresAt !== undefined &&
        !isSafeTimestamp(value.idleExpiresAt)) ||
      !isSessionData(value.data)
    ) {
      return undefined;
    }

    // TYPE-EVIDENCE: validation above proves each field and the recursive session data shape.
    return value as SessionRecord<TData>;
  } catch {
    return undefined;
  }
}

function isSafeTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isSessionData(value: unknown): value is SessionData {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isSessionData);
  }

  return isObject(value) && Object.values(value).every(isSessionData);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExpired(record: SessionRecord, now: number) {
  return record.expiresAt <= now ||
    (record.idleExpiresAt !== undefined && record.idleExpiresAt <= now);
}

function destroyedCookie(cookie: ResolvedOptions["cookie"]) {
  return createSecureCookie({
    ...cookie,
    expires: new Date(0),
    maxAge: 0,
    value: "",
  });
}

function randomIdentifier(randomBytes: (length: number) => Uint8Array) {
  const bytes = randomBytes(sessionIdentifierBytes);

  if (bytes.byteLength !== sessionIdentifierBytes) {
    throw new Error(
      "Demiurge cookie session randomBytes returned an incorrect byte count.",
    );
  }

  return encodeBase64Url(bytes);
}

function secureRandomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length));
}

function cloneData<TData extends SessionData>(data: TData): TData {
  if (!isSessionData(data)) {
    throw new Error(
      "Demiurge session data must contain only finite JSON values.",
    );
  }

  return structuredClone(data);
}

function cloneRecord<TData extends SessionData>(record: SessionRecord<TData>) {
  return structuredClone(record);
}

function encodeText(value: string) {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return undefined;
  }

  try {
    const padding = "=".repeat((4 - value.length % 4) % 4);
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}
