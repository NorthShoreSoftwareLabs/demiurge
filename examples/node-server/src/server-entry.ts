export { createHandler, routes } from "virtual:demiurge/server-entry";
export { locales } from "./localization";
// The server process needs the font declaration to publish the same URLs the
// documents ask for, so the bundle carries it.
export { fonts } from "./fonts";
