export { createHandler, routes } from "virtual:demiurge/server-entry";
// The server process needs the font declaration to publish the same URLs the
// documents ask for, so the bundle carries it.
export { fonts } from "./fonts";
