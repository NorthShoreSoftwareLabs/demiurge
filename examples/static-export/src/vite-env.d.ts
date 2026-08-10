/// <reference types="vite/client" />

declare module "virtual:demiurge/server-entry" {
  import type { RouteImporter } from "demiurge";

  export const routes: Record<string, RouteImporter>;
}
