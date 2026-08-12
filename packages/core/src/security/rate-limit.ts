import type {
  MemoryRateLimitStoreOptions,
  RateLimitKey,
  RateLimitPolicy,
  RateLimitStore,
} from "./types";
import { getRequestConnectionMetadata } from "../server/request-metadata";

const durationUnits = {
  h: 60 * 60 * 1000,
  m: 60 * 1000,
  s: 1000,
} as const;

type MemoryRateLimitEntry = {
  count: number;
  resetAt: number;
};

const defaultMaximumEntries = 10_000;

export function createMemoryRateLimitStore(
  options: MemoryRateLimitStoreOptions = {},
): RateLimitStore {
  const maximumEntries = options.maximumEntries ?? defaultMaximumEntries;

  if (!Number.isSafeInteger(maximumEntries) || maximumEntries <= 0) {
    throw new Error(
      "Demiurge rate limit maximumEntries must be a positive integer.",
    );
  }

  const entries = new Map<string, MemoryRateLimitEntry>();
  let nextExpiration = Number.POSITIVE_INFINITY;

  return {
    increment(key, windowMs, now) {
      if (now >= nextExpiration) {
        sweepExpiredEntries(entries, now);
        nextExpiration = findNextExpiration(entries);
      }

      const existing = entries.get(key);

      if (!existing || existing.resetAt <= now) {
        const next = {
          count: 1,
          resetAt: now + windowMs,
        };

        if (!existing && entries.size >= maximumEntries) {
          evictOldestEntry(entries);
        }

        entries.set(key, next);
        nextExpiration = Math.min(nextExpiration, next.resetAt);
        return next;
      }

      existing.count += 1;
      return existing;
    },
  };
}

function sweepExpiredEntries(
  entries: Map<string, MemoryRateLimitEntry>,
  now: number,
) {
  for (const [key, entry] of entries) {
    if (entry.resetAt <= now) {
      entries.delete(key);
    }
  }
}

function findNextExpiration(entries: Map<string, MemoryRateLimitEntry>) {
  let nextExpiration = Number.POSITIVE_INFINITY;

  for (const entry of entries.values()) {
    nextExpiration = Math.min(nextExpiration, entry.resetAt);
  }

  return nextExpiration;
}

function evictOldestEntry(entries: Map<string, MemoryRateLimitEntry>) {
  const oldestKey = entries.keys().next().value;

  if (oldestKey !== undefined) {
    entries.delete(oldestKey);
  }
}

export function enforceRateLimit(
  policy: RateLimitPolicy | undefined,
  request: Request,
  store: RateLimitStore,
  now = Date.now(),
) {
  if (!policy) {
    return null;
  }

  validateRateLimitPolicy(policy);

  const windowMs = parseRateLimitWindow(policy.window);
  const key = rateLimitStoreKey(policy, request);
  const result = store.increment(key, windowMs, now);
  const remaining = Math.max(0, policy.limit - result.count);
  const headers = new Headers({
    "retry-after": String(Math.ceil(Math.max(0, result.resetAt - now) / 1000)),
    "x-ratelimit-limit": String(policy.limit),
    "x-ratelimit-remaining": String(remaining),
    "x-ratelimit-reset": String(Math.ceil(result.resetAt / 1000)),
  });

  if (result.count > policy.limit) {
    return new Response("Rate limit exceeded.", {
      headers,
      status: 429,
    });
  }

  return null;
}

export function parseRateLimitWindow(value: number | string) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Demiurge rate limit window must be a positive integer.");
    }

    return value;
  }

  const match = /^(\d+)(s|m|h)$/i.exec(value.trim());

  if (!match) {
    throw new Error("Demiurge rate limit window must use an s/m/h suffix.");
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase() as keyof typeof durationUnits;
  const duration = amount * durationUnits[unit];

  if (!Number.isSafeInteger(duration)) {
    throw new Error("Demiurge rate limit window is too large.");
  }

  return duration;
}

export function validateRateLimitPolicy(policy: RateLimitPolicy) {
  if (!Number.isSafeInteger(policy.limit) || policy.limit <= 0) {
    throw new Error("Demiurge rate limit limit must be a positive integer.");
  }

  parseRateLimitWindow(policy.window);
}

function rateLimitStoreKey(policy: RateLimitPolicy, request: Request) {
  return `${rateLimitKeyName(policy.key)}:${resolveRateLimitKey(policy.key, request)}`;
}

function rateLimitKeyName(key: RateLimitKey) {
  return typeof key === "string" ? key : `header:${key.header.toLowerCase()}`;
}

function resolveRateLimitKey(key: RateLimitKey, request: Request) {
  if (key === "ip") {
    return clientIp(request);
  }

  return request.headers.get(key.header) ?? "missing";
}

function clientIp(request: Request) {
  return getRequestConnectionMetadata(request)?.clientIp ?? "unknown";
}
