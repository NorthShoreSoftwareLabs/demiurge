/// <reference types="vite/client" />

declare module "virtual:demiurge/server-entry" {
  import type {
    RequestHandler,
    RequestHandlerOptions,
    SsrOptions,
  } from "@demiurgejs/core";

  export const routes: RequestHandlerOptions["routes"];

  export function createHandler(
    options?: Omit<RequestHandlerOptions, "routes" | "ssr"> & SsrOptions,
  ): RequestHandler;
}
