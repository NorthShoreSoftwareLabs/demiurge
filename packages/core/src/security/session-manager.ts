import {
  createSecureCookie,
  secureCookieName,
} from "./cookies";
import type {
  CookieSessionCreateOptions,
  SessionCookieDefinition,
  SessionCookieKey,
} from "./cookie-session";
import { parseCookieHeader } from "./csrf";
import type {
  SessionData,
  SessionRecord,
  SessionStore,
  SessionStoreWriteResult,
} from "./session-store";

const defaultAbsoluteExpirationMs = 7 * 24 * 60 * 60 * 1000;
const defaultIdleExpirationMs = 24 * 60 * 60 * 1000;

export type SessionManagerOptions<TData extends SessionData> = {
  absoluteExpirationMs?: number;
  cookie?: SessionCookieDefinition;
  idleExpirationMs?: false | number;
  keys: readonly SessionCookieKey[];
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
  renewal?: boolean;
  store: SessionStore<TData>;
};

export type ServerSession<TData extends SessionData> = {
  commit: () => Promise<readonly string[]>;
  create: (
    data: TData,
    options?: CookieSessionCreateOptions,
  ) => Promise<SessionRecord<TData>>;
  destroy: () => Promise<void>;
  get: () => SessionRecord<TData> | undefined;
  rotate: (data?: TData) => Promise<SessionRecord<TData>>;
  update: (data: TData) => Promise<SessionRecord<TData>>;
};

export type SessionManager<TData extends SessionData> = {
  cookieName: string;
  open: (request: Request) => Promise<ServerSession<TData>>;
};

export class SessionStoreConflictError extends Error {
  constructor(operation: string) {
    super(
      `Demiurge session ${operation} conflicted with another request. Load the current session before another lifecycle operation.`,
    );
    this.name = "SessionStoreConflictError";
  }
}

export class SessionStoreUnavailableError extends Error {
  constructor(operation: string) {
    super(
      `Demiurge session ${operation} failed because the session store is unavailable.`,
    );
    this.name = "SessionStoreUnavailableError";
  }
}

export function createSessionManager<TData extends SessionData>(
  input: SessionManagerOptions<TData>,
): SessionManager<TData> {
  const options = resolveOptions(input);
  const cookieName = secureCookieName(
    options.cookie.name,
    options.cookie.scope ?? "host",
  );

  return {
    cookieName,
    async open(request) {
      const rawCookie = parseCookieHeader(request.headers.get("cookie") ?? "")
        .get(cookieName);
      const decoded = rawCookie
        ? await verifyIdentifier(rawCookie, options.keys)
        : undefined;
      const now = options.now();
      let record = decoded
        ? await options.store.read(decoded.id, now)
        : undefined;
      let destroyCookie = Boolean(rawCookie && (!decoded || !record));
      let dirty = Boolean(record && decoded && !decoded.currentKey);

      if (
        record &&
        options.renewal &&
        options.idleExpirationMs !== false &&
        record.idleExpiresAt !== undefined &&
        record.idleExpiresAt - now <= options.idleExpirationMs / 4
      ) {
        const renewed = await options.store.update({
          ...withoutVersion(record),
          idleExpiresAt: Math.min(
            record.expiresAt,
            now + options.idleExpirationMs,
          ),
        }, record.version);

        if (renewed.status === "stored") {
          record = renewed.record;
          dirty = true;
        } else if (renewed.status === "conflict") {
          record = await options.store.read(record.id, now);
          destroyCookie = !record;
        } else {
          throw new SessionStoreUnavailableError("renewal");
        }
      }

      const requireRecord = () => {
        if (!record) {
          throw new Error(
            "Demiurge cannot change a session that does not exist. Create the session first.",
          );
        }

        return record;
      };

      const accept = (
        result: SessionStoreWriteResult<TData>,
        operation: string,
      ) => {
        if (result.status === "conflict") {
          throw new SessionStoreConflictError(operation);
        }

        if (result.status === "unavailable") {
          throw new SessionStoreUnavailableError(operation);
        }

        record = cloneRecord(result.record);
        destroyCookie = false;
        dirty = true;
        return cloneRecord(result.record);
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
            value: await signIdentifier(record.id, options.keys[0]),
          })];
        },
        async create(data, createOptions = {}) {
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
          const candidate = {
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
          };

          return accept(await options.store.create(candidate), "creation");
        },
        async destroy() {
          if (record) {
            await options.store.destroy(record.id);
          }

          record = undefined;
          destroyCookie = true;
          dirty = false;
        },
        get() {
          return record ? cloneRecord(record) : undefined;
        },
        async rotate(data) {
          const current = requireRecord();
          const candidate = {
            ...withoutVersion(current),
            data: data === undefined ? current.data : cloneData(data),
            id: randomIdentifier(options.randomBytes),
          };
          return accept(
            await options.store.rotate(current.id, candidate, current.version),
            "rotation",
          );
        },
        async update(data) {
          const current = requireRecord();
          return accept(
            await options.store.update({
              ...withoutVersion(current),
              data: cloneData(data),
            }, current.version),
            "update",
          );
        },
      };
    },
  };
}

type ResolvedOptions<TData extends SessionData> = {
  absoluteExpirationMs: number;
  cookie: Required<Pick<SessionCookieDefinition, "name">> &
    Omit<SessionCookieDefinition, "name">;
  idleExpirationMs: false | number;
  keys: readonly SessionCookieKey[];
  now: () => number;
  randomBytes: (length: number) => Uint8Array;
  renewal: boolean;
  store: SessionStore<TData>;
};

function resolveOptions<TData extends SessionData>(
  input: SessionManagerOptions<TData>,
): ResolvedOptions<TData> {
  if (!input.store || typeof input.store.read !== "function") {
    throw new Error(
      "Demiurge session manager requires a SessionStore implementation.",
    );
  }

  const keys = validateKeys(input.keys);
  return {
    absoluteExpirationMs: validateLifetime(
      "absoluteExpirationMs",
      input.absoluteExpirationMs ?? defaultAbsoluteExpirationMs,
    ),
    cookie: { ...input.cookie, name: input.cookie?.name ?? "session" },
    idleExpirationMs: validateIdleLifetime(
      input.idleExpirationMs ?? defaultIdleExpirationMs,
    ),
    keys,
    now: input.now ?? Date.now,
    randomBytes: input.randomBytes ?? secureRandomBytes,
    renewal: input.renewal ?? true,
    store: input.store,
  };
}

function validateKeys(keys: readonly SessionCookieKey[]) {
  if (keys.length === 0) {
    throw new Error(
      "Demiurge session manager requires at least one key. Put the current key first.",
    );
  }

  const identifiers = new Set<string>();

  for (const key of keys) {
    if (!/^[A-Za-z0-9_-]+$/.test(key.id) || identifiers.has(key.id)) {
      throw new Error(
        "Demiurge session manager key identifiers must be unique token values.",
      );
    }

    if (key.value.byteLength < 32) {
      throw new Error(
        `Demiurge session manager key ${JSON.stringify(key.id)} must contain at least 32 bytes.`,
      );
    }

    identifiers.add(key.id);
  }

  return [...keys];
}

async function signIdentifier(id: string, key: SessionCookieKey) {
  const unsigned = `i1.${key.id}.${id}`;
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
    toArrayBuffer(new TextEncoder().encode(unsigned)),
  );
  return `${unsigned}.${encodeBase64Url(new Uint8Array(signature))}`;
}

async function verifyIdentifier(
  value: string,
  keys: readonly SessionCookieKey[],
) {
  const parts = value.split(".");

  if (
    parts.length !== 4 ||
    parts[0] !== "i1" ||
    !/^[A-Za-z0-9_-]{43}$/.test(parts[2])
  ) {
    return undefined;
  }

  const keyIndex = keys.findIndex((key) => key.id === parts[1]);
  const key = keys[keyIndex];
  const signature = decodeBase64Url(parts[3]);

  if (!key || !signature) {
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
    toArrayBuffer(new TextEncoder().encode(parts.slice(0, 3).join("."))),
  );
  return valid
    ? { currentKey: keyIndex === 0, id: parts[2] }
    : undefined;
}

function withoutVersion<TData extends SessionData>(record: SessionRecord<TData>) {
  const { version: _version, ...candidate } = record;
  return candidate;
}

function destroyedCookie(cookie: ResolvedOptions<SessionData>["cookie"]) {
  return createSecureCookie({
    ...cookie,
    expires: new Date(0),
    maxAge: 0,
    value: "",
  });
}

function validateLifetime(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(
      `Demiurge session manager ${name} must be a positive whole number of milliseconds.`,
    );
  }

  return value;
}

function validateIdleLifetime(value: false | number) {
  return value === false ? false : validateLifetime("idleExpirationMs", value);
}

function randomIdentifier(randomBytes: (length: number) => Uint8Array) {
  const bytes = randomBytes(32);

  if (bytes.byteLength !== 32) {
    throw new Error(
      "Demiurge session manager randomBytes returned an incorrect byte count.",
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

  return typeof value === "object" && value !== null &&
    Object.values(value).every(isSessionData);
}

function cloneRecord<TData extends SessionData>(record: SessionRecord<TData>) {
  return structuredClone(record);
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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}
