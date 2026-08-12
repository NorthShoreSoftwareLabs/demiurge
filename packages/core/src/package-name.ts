// The package name is the specifier that user code imports. Generated client
// entries, server entries, and route type declarations use it. Page route
// detection also compares application source with it. A mismatch then breaks
// resolution in the consumer build.
//
// This is deliberately not the same thing as the many internal `demiurge`
// strings elsewhere in the source. `__demiurge_data`, `virtual:demiurge/*`,
// `demiurge-manifest.json`, and friends name the framework, not the package,
// and they stay put if the registry name ever changes.
export const PACKAGE_NAME = "@demiurgejs/core";
