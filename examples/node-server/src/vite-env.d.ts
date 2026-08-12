/// <reference types="vite/client" />

declare module "virtual:demiurge/server-entry" {
  import type {
    RequestHandler,
    RequestHandlerOptions,
    SsrOptions,
  } from "@demiurge-js/core";

  export const routes: RequestHandlerOptions["routes"];

  // The generated entry owns `routes` and lifts the SSR options to the top
  // level, so the build manifest can be handed straight to it.
  export function createHandler(
    options?: Omit<RequestHandlerOptions, "routes" | "ssr"> & SsrOptions,
  ): RequestHandler;
}
