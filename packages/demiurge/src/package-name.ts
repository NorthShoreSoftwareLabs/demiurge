// The name this package is published under, which is the specifier user code
// imports the framework from. It is generated into client entries, server
// entries, and route type declarations, and it is matched against app source
// to detect page routes, so a mismatch breaks resolution in a consumer's build
// rather than in ours.
//
// This is deliberately not the same thing as the many internal `demiurge`
// strings elsewhere in the source. `__demiurge_data`, `virtual:demiurge/*`,
// `demiurge-manifest.json`, and friends name the framework, not the package,
// and they stay put if the registry name ever changes.
export const PACKAGE_NAME = "demiurge";
