import type { DemiurgeConfig } from "./types";

// This builder gives editor completion and type checking to the application
// configuration file. It returns the value without a change.
export function defineConfig(config: DemiurgeConfig): DemiurgeConfig {
  return config;
}
