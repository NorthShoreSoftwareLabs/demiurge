/// <reference types="vite/client" />

declare module "virtual:demiurge/server-entry" {
  import type { RequestHandler } from "demiurge";

  export const routes: unknown[];
  export function createHandler(
    options?: Record<string, unknown>,
  ): RequestHandler;
}
