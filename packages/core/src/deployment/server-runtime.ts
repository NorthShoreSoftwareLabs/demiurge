import type { Adapter } from "../adapter";
import type { RateLimitStore } from "../security";
import type {
  PageRenderer,
  RequestCacheStoreOptions,
  RequestHandler,
} from "../server";

export type ServerBuildPageOptions = {
  adapter: Adapter;
  cacheStore: RequestCacheStoreOptions;
  clientEntry: string;
  rateLimitStore: RateLimitStore;
  renderPage: PageRenderer;
  styles: string[];
};

export type ServerBuildRuntime = {
  createHandler: (
    options: ServerBuildPageOptions,
  ) => RequestHandler | Promise<RequestHandler>;
};
