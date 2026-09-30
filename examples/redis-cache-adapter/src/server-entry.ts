import type { NodeBuildContext } from "@demiurgejs/core/node";
import {
  createHandler as createGeneratedHandler,
  routes,
} from "virtual:demiurge/server-entry";
import { namespace, store } from "./redis.server";

export { routes };

export function createHandler({ page, waitUntil }: NodeBuildContext) {
  return createGeneratedHandler({
    ...page,
    cacheStore: { namespace, store, waitUntil },
  });
}
