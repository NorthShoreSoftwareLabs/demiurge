export { demiurge } from "./plugin";
export {
  assertRootNotFoundRoute as unstable_assertRootNotFoundRoute,
  declaresPageRoute as unstable_declaresPageRoute,
  createClientEntrySource as unstable_createClientEntrySource,
  createServerEntrySource as unstable_createServerEntrySource,
  createDocumentHtml as unstable_createDocumentHtml,
  createDevRouteImporters as unstable_createDevRouteImporters,
  handleDevRequest as unstable_handleDevRequest,
  stripClientPageData as unstable_stripClientPageData,
  verifyRoutePolicies as unstable_verifyRoutePolicies,
  formatStaticPolicyFindings as unstable_formatStaticPolicyFindings,
} from "./plugin";
export {
  verifyRoutePolicySource as unstable_verifyRoutePolicySource,
} from "./policy-verification";
export type {
  DemiurgeVitePluginApi,
  DemiurgeVitePluginOptions,
} from "./plugin";
