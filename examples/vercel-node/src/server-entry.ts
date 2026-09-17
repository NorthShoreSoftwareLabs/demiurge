import { createHandler as createDemiurgeHandler, routes } from "virtual:demiurge/server-entry";
export { routes };

type ServerBuildContext = {
  page: Parameters<typeof createDemiurgeHandler>[0];
};

export function createHandler({ page }: ServerBuildContext) {
  return createDemiurgeHandler(page);
}
