export {
  assertRootNotFoundRoute as unstable_assertRootNotFoundRoute,
  createClientEntrySource as unstable_createClientEntrySource,
  createClientEnvSource as unstable_createClientEnvSource,
  createServerEntrySource as unstable_createServerEntrySource,
  createDocumentHtml as unstable_createDocumentHtml,
  createDevRouteImporters as unstable_createDevRouteImporters,
  handleDevRequest as unstable_handleDevRequest,
  stripClientPageData as unstable_stripClientPageData,
  verifyRoutePolicies as unstable_verifyRoutePolicies,
  formatStaticPolicyFindings as unstable_formatStaticPolicyFindings,
} from "./plugin";
export {
  isRouteAuditEnabled as unstable_isRouteAuditEnabled,
} from "./plugin";
export {
  declaresPageRoute as unstable_declaresPageRoute,
  inspectRouteFile as unstable_inspectRouteFile,
  verifyRoutePolicySource as unstable_verifyRoutePolicySource,
} from "./policy-verification";
export type {
  RouteFileInspection as unstable_RouteFileInspection,
  StaticPolicyFinding as unstable_StaticPolicyFinding,
} from "./policy-verification";
export {
  findEnvKeyReferences as unstable_findEnvKeyReferences,
  findImportPath as unstable_findEnvImportPath,
  findServerEnvKeys as unstable_findServerEnvKeys,
  formatEnvBoundaryFindings as unstable_formatEnvBoundaryFindings,
} from "./env-boundary";
export type {
  EnvBoundaryFinding as unstable_EnvBoundaryFinding,
} from "./env-boundary";
export {
  createRouteAudit as unstable_createRouteAudit,
  renderRouteAuditDocument as unstable_renderRouteAuditDocument,
  ROUTE_AUDIT_PATH as unstable_ROUTE_AUDIT_PATH,
} from "./route-audit";
export {
  demiurge as unstable_demiurge,
} from "./plugin";
export type {
  DemiurgeVitePluginApi as unstable_DemiurgeVitePluginApi,
  DemiurgeVitePluginOptions as unstable_DemiurgeVitePluginOptions,
} from "./plugin";
export type {
  RouteAudit,
  RouteAuditCacheRead,
  RouteAuditRoute,
  RouteAuditScript,
} from "./route-audit";
