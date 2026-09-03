import { readFile } from "node:fs/promises";
import { basename, dirname, relative, sep } from "node:path";
import { parseAst, transformWithEsbuild } from "vite";
import type { HttpMethod } from "../route";
import {
  createSecurityHeaders,
  security,
  validateCorsPolicy,
  validateRateLimitPolicy,
  type ContentSecurityPolicy,
  type CorsPolicy,
  type RoutePolicy,
  type RouteSecurityPolicy,
  type SecurityPolicy,
} from "../security";
import { PACKAGE_NAME } from "../package-name";
import { isPlainObject } from "../type-guards";

type AstNode = {
  [key: string]: unknown;
  end: number;
  start: number;
  type: string;
};

// TYPE-EVIDENCE: rollup returns a generic program node. The local type is a loose access shape.
function asAstNode(value: unknown): AstNode {
  // TYPE-EVIDENCE: the caller passes a rollup program node. The cast labels it with the loose access shape.
  return value as AstNode;
}

export type StaticPolicyFinding = {
  code: "cors-invalid" | "cors-method-unavailable" | "document-policy-missing" |
    "rate-limit-invalid" | "security-header-render-failed";
  exportName?: string;
  file: string;
  message: string;
  severity: "error" | "warning";
};

export type RouteFileInspection = {
  /**
   * `true` when the file declares a document policy, and also when the policy
   * expression is not statically readable. An unreadable expression is not
   * evidence of an absent policy.
   */
  declaresDocumentPolicy: boolean;
  /** The statically provable CSP state of the route policy. */
  documentCspState: DocumentCspState;
  declaresPageRoute: boolean;
  file: string;
  findings: StaticPolicyFinding[];
};

export type DocumentCspState = "present" | "false" | "absent" | "unknown";

type ExtractedCapability = {
  cors?: CorsPolicy;
  security?: RouteSecurityPolicy;
};

type ExtractedRouteModule = {
  capabilities: Partial<Record<HttpMethod, ExtractedCapability>>;
  declaredMethods: Set<HttpMethod>;
  declaresDocumentPolicy: boolean;
  documentCspState: DocumentCspState;
  policy?: RoutePolicy;
};

const httpMethods = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
  "HEAD",
] as const satisfies readonly HttpMethod[];
const responseHelpers = new Set([
  "mutation",
  "html",
  "json",
  "jsonl",
  "notFound",
  "redirect",
  "response",
  "sse",
  "stream",
  "text",
]);

export async function verifyRoutePolicyFile(file: string) {
  return (await inspectRouteFile(file)).findings;
}

export async function inspectRouteFile(
  file: string,
): Promise<RouteFileInspection> {
  const source = await readFile(file, "utf8");
  const extracted = await extractRouteModuleSource(source, file);

  return {
    declaresDocumentPolicy: extracted.declaresDocumentPolicy,
    documentCspState: extracted.documentCspState,
    // An attached file owns no address, so it never declares a page route.
    declaresPageRoute: !basename(file).startsWith("@") &&
      declaresPageRoute(source),
    file,
    findings: validateExtractedRouteModule(extracted, file),
  };
}

export async function verifyRoutePolicySource(source: string, file: string) {
  return validateExtractedRouteModule(
    await extractRouteModuleSource(source, file),
    file,
  );
}

async function extractRouteModuleSource(source: string, file: string) {
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  const transformed = await transformWithEsbuild(source, file, {
    format: "esm",
    loader,
    target: "esnext",
  });

  return extractRouteModule(transformed.code);
}

// A page route that inherits no document policy sends no security headers.
// The application still works, so nothing else reports the gap. This check
// reads the policy cascade of the route tree and names each page route that
// no document policy covers.
export function auditDocumentPolicyCoverage(
  routesDir: string,
  inspections: readonly RouteFileInspection[],
): StaticPolicyFinding[] {
  const policies = inspections.filter((inspection) => isPolicyFile(inspection.file));

  const findings: StaticPolicyFinding[] = [];

  for (const inspection of inspections) {
    if (!inspection.declaresPageRoute) {
      continue;
    }
    const state = resolveDocumentCspState(
      routesDir,
      dirname(inspection.file),
      inspection.documentCspState,
      policies,
    );
    if (state !== "absent") {
      continue;
    }

    findings.push({
      code: "document-policy-missing",
      file: inspection.file,
      message:
        "This page route inherits no document policy, so its HTML response carries no Content-Security-Policy. Add document: security.strict() to this route or an ancestor @policy.ts file.",
      severity: "warning",
    });
  }

  return findings;
}

function resolveDocumentCspState(
  routesDir: string,
  routeDirectory: string,
  routeState: DocumentCspState,
  policies: readonly RouteFileInspection[],
) {
  const applicable = policies
    .filter((inspection) =>
      isSameOrAbove(dirname(inspection.file), routeDirectory) &&
      isSameOrAbove(routesDir, dirname(inspection.file)),
    )
    .sort((left, right) =>
      dirname(left.file).length - dirname(right.file).length ||
      left.file.localeCompare(right.file)
    );

  let state: DocumentCspState = "absent";
  for (const policy of applicable) {
    state = mergeDocumentCspState(state, policy.documentCspState);
  }
  return mergeDocumentCspState(state, routeState);
}

function mergeDocumentCspState(
  base: DocumentCspState,
  override: DocumentCspState,
): DocumentCspState {
  if (override === "absent") return base;
  return override;
}

function isPolicyFile(file: string) {
  return /^@policy\.tsx?$/.test(basename(file));
}

function isSameOrAbove(directory: string, routesDir: string) {
  const distance = relative(directory, routesDir);
  return distance === "" ||
    (distance !== ".." && !distance.startsWith(`..${sep}`) &&
      !distance.startsWith(sep));
}

// Escaped because a package name may contain `.`, which the regex would
// otherwise read as a wildcard.
const PACKAGE_NAME_PATTERN = PACKAGE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DEMIURGE_NAMED_IMPORT = new RegExp(
  `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${PACKAGE_NAME_PATTERN}["']`,
  "g",
);

// The plugin cannot evaluate route modules during the build. Therefore, page
// detection reads the source. It checks the import, not only the word. An API
// application can call `db.users.page(2)` without serving an HTML document.
// Only a page route imports `page` from the framework package.
export function declaresPageRoute(source: string) {
  const locals = [...source.matchAll(DEMIURGE_NAMED_IMPORT)].flatMap((match) =>
    match[1].split(",").flatMap((binding) => {
      const [imported, local] = binding.trim().split(/\s+as\s+/);

      // `import type { page }` cannot be called, and an alias renames what the
      // call site looks like.
      return imported.replace(/^type\s+/, "") === "page"
        ? [local ?? imported]
        : [];
    }),
  );

  if (locals.length === 0) {
    return false;
  }

  // Strip the import statements first so the binding list is not itself
  // mistaken for a call.
  const body = source.replace(DEMIURGE_NAMED_IMPORT, "");

  return locals.some((local) => new RegExp(`\\b${local}\\s*\\(`).test(body));
}

function extractRouteModule(code: string): ExtractedRouteModule {
  const ast = asAstNode(parseAst(code));
  const imports = collectCoreImports(ast);
  const constants = collectConstants(ast);
  const declarations = collectVariableInitializers(ast);
  const exports = collectNamedExports(ast);
  const capabilities: ExtractedRouteModule["capabilities"] = {};
  const declaredMethods = new Set<HttpMethod>();
  let declaresDocumentPolicy = false;
  let documentCspState: DocumentCspState = "absent";
  let policy: RoutePolicy | undefined;

  for (const [exportName, localName] of exports) {
    const initializer = declarations.get(localName);

    if (exportName === "policy") {
      documentCspState = initializer
        ? extractDocumentCspState(initializer, imports, constants)
        : "unknown";
      declaresDocumentPolicy = documentCspState !== "absent";
      if (initializer) {
        policy = extractRoutePolicy(initializer, imports, constants);
      }
      continue;
    }
    if (!isHttpMethod(exportName)) continue;
    declaredMethods.add(exportName);
    if (!initializer) continue;

    const capability = extractCapability(initializer, imports, constants);
    if (capability) capabilities[exportName] = capability;
  }

  return {
    capabilities,
    declaredMethods,
    declaresDocumentPolicy,
    documentCspState,
    policy,
  };
}

function extractDocumentCspState(
  node: AstNode,
  imports: Map<string, string>,
  constants: Map<string, unknown>,
): DocumentCspState {
  if (node.type === "Identifier") {
    if (node.name === "undefined") return "absent";
    const value = constants.get(String(node.name));
    return value === undefined && !constants.has(String(node.name))
      ? "unknown"
      : extractDocumentCspStateFromValue(value);
  }

  if (node.type === "CallExpression") {
    const localName = identifierName(node.callee);
    if (localName && imports.get(localName) === "defineRoutePolicy") {
      const argument = asNodeArray(node.arguments)[0];
      return argument
        ? extractDocumentCspState(argument, imports, constants)
        : "unknown";
    }

    const callee = asNode(node.callee);
    if (callee?.type === "MemberExpression") {
      const objectName = identifierName(callee.object);
      const preset = propertyName(callee.property);
      if (objectName && imports.get(objectName) === "security" && preset) {
        return extractPresetCspState(preset, asNodeArray(node.arguments)[0], constants);
      }
    }
    return "unknown";
  }

  if (node.type !== "ObjectExpression") return "unknown";

  for (const property of asNodeArray(node.properties)) {
    if (property.type === "SpreadElement") return "unknown";
    if (property.type !== "Property") continue;
    if (property.computed) return "unknown";
    if (propertyName(property.key) !== "document") continue;
    return extractDocumentSecurityCspState(
      asNode(property.value),
      imports,
      constants,
    );
  }

  return "absent";
}

function extractDocumentSecurityCspState(
  node: AstNode | undefined,
  imports: Map<string, string>,
  constants: Map<string, unknown>,
): DocumentCspState {
  if (!node) return "unknown";
  if (node.type === "UnaryExpression" && node.operator === "void") {
    return "absent";
  }
  if (node.type === "Identifier") {
    if (node.name === "undefined") return "absent";
    const value = constants.get(String(node.name));
    return value === undefined && !constants.has(String(node.name))
      ? "unknown"
      : extractDocumentCspStateFromValue(value);
  }
  if (node.type === "CallExpression") {
    const callee = asNode(node.callee);
    if (callee?.type !== "MemberExpression") return "unknown";
    const objectName = identifierName(callee.object);
    const preset = propertyName(callee.property);
    if (!objectName || imports.get(objectName) !== "security" || !preset) {
      return "unknown";
    }
    return extractPresetCspState(preset, asNodeArray(node.arguments)[0], constants);
  }
  if (node.type !== "ObjectExpression") return "unknown";

  for (const property of asNodeArray(node.properties)) {
    if (property.type === "SpreadElement" || property.computed) return "unknown";
    if (property.type !== "Property") continue;
    if (propertyName(property.key) !== "csp") continue;
    const value = asNode(property.value);
    if (!value) return "unknown";
    if (value.type === "Literal") {
      if (value.value === false) return "false";
      if (value.value === undefined || value.value === null) return "absent";
      return "present";
    }
    if (value.type === "Identifier") {
      const literal = evaluateLiteral(value, constants);
      if (literal === unresolved) return "unknown";
      return extractCspValueState(literal);
    }
    if (value.type === "ObjectExpression" || value.type === "ArrayExpression") {
      return "present";
    }
    return "unknown";
  }

  return "absent";
}

function extractPresetCspState(
  preset: string,
  optionsNode: AstNode | undefined,
  constants: Map<string, unknown>,
): DocumentCspState {
  const defaultState = preset === "api" ? "absent" :
    preset === "strict" || preset === "static" || preset === "crossOriginIsolated"
      ? "present"
      : "unknown";
  if (!optionsNode) return defaultState;
  if (optionsNode.type === "Identifier") {
    const options = evaluateLiteral(optionsNode, constants);
    if (options === unresolved) return "unknown";
    return mergePresetCspState(defaultState, extractCspOptionState(options));
  }
  if (optionsNode.type !== "ObjectExpression") return "unknown";
  for (const property of asNodeArray(optionsNode.properties)) {
    if (property.type === "SpreadElement" || property.computed) return "unknown";
    if (property.type !== "Property") continue;
    if (propertyName(property.key) !== "csp") continue;
    const value = evaluateLiteral(asNode(property.value), constants);
    if (value === unresolved) return "unknown";
    return mergePresetCspState(defaultState, extractCspValueState(value));
  }
  return defaultState;
}

function extractCspOptionState(value: unknown): DocumentCspState {
  if (!isPlainObject(value)) return value === undefined ? "absent" : "unknown";
  if (!Object.prototype.hasOwnProperty.call(value, "csp")) return "absent";
  return extractCspValueState(value.csp);
}

function extractCspValueState(value: unknown): DocumentCspState {
  if (value === false) return "false";
  if (value === undefined || value === null) return "absent";
  if (isPlainObject(value) || Array.isArray(value)) return "present";
  return "unknown";
}

function mergePresetCspState(
  preset: DocumentCspState,
  override: DocumentCspState,
): DocumentCspState {
  if (override === "absent") return preset;
  return override;
}

function extractDocumentCspStateFromValue(value: unknown): DocumentCspState {
  if (value === undefined) return "absent";
  if (!isPlainObject(value)) return "unknown";
  if (!Object.prototype.hasOwnProperty.call(value, "document")) return "absent";
  return extractCspOptionState(value.document);
}

function collectVariableInitializers(ast: AstNode) {
  const declarations = new Map<string, AstNode>();
  for (const statement of asNodeArray(ast.body)) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? asNode(statement.declaration)
      : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of asNodeArray(declaration.declarations)) {
      const name = identifierName(declarator.id);
      const initializer = asNode(declarator.init);
      if (name && initializer) declarations.set(name, initializer);
    }
  }
  return declarations;
}

function collectNamedExports(ast: AstNode) {
  const exports = new Map<string, string>();
  for (const statement of asNodeArray(ast.body)) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = asNode(statement.declaration);
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of asNodeArray(declaration.declarations)) {
        const name = identifierName(declarator.id);
        if (name) exports.set(name, name);
      }
    }
    for (const specifier of asNodeArray(statement.specifiers)) {
      const exported = propertyName(specifier.exported);
      const local = propertyName(specifier.local);
      if (exported && local) exports.set(exported, local);
    }
  }
  return exports;
}

function extractCapability(
  node: AstNode,
  imports: Map<string, string>,
  constants: Map<string, unknown>,
) {
  if (node.type !== "CallExpression") return undefined;
  const localName = identifierName(node.callee);
  const helper = localName ? imports.get(localName) : undefined;

  if (!helper || !responseHelpers.has(helper)) return undefined;
  const arguments_ = asNodeArray(node.arguments);
  const optionsNode = helper === "mutation" ? arguments_[0] : arguments_[1];
  if (!optionsNode) return {};
  const cors = evaluateObjectProperty(optionsNode, "cors", constants);
  const securityPolicy = evaluateObjectProperty(
    optionsNode,
    "security",
    constants,
  );

  // TYPE-EVIDENCE: the isPlainObject checks confirm the values are plain objects. The casts label them as the capability policy types.
  return {
    cors: isPlainObject(cors) ? cors as CorsPolicy : undefined,
    security: isPlainObject(securityPolicy)
      ? securityPolicy as RouteSecurityPolicy
      : undefined,
  } satisfies ExtractedCapability;
}

function evaluateObjectProperty(
  node: AstNode,
  property: string,
  constants: Map<string, unknown>,
) {
  if (node.type === "Identifier") {
    const value = constants.get(String(node.name));
    return isPlainObject(value) ? value[property] : unresolved;
  }
  if (node.type !== "ObjectExpression") return unresolved;

  let value: unknown = undefined;
  for (const item of asNodeArray(node.properties)) {
    if (item.type !== "Property" || item.computed) return unresolved;
    if (propertyName(item.key) !== property) continue;
    value = evaluateLiteral(asNode(item.value), constants);
  }

  return value;
}

function extractRoutePolicy(
  node: AstNode,
  imports: Map<string, string>,
  constants: Map<string, unknown>,
): RoutePolicy | undefined {
  if (node.type === "CallExpression") {
    const localName = identifierName(node.callee);
    if (localName && imports.get(localName) === "defineRoutePolicy") {
      const argument = asNodeArray(node.arguments)[0];
      return argument
        ? extractRoutePolicy(argument, imports, constants)
        : undefined;
    }
  }

  if (node.type !== "ObjectExpression") {
    const value = evaluateLiteral(node, constants);
    // TYPE-EVIDENCE: the isPlainObject check confirms the value is a plain object. The cast labels it as a route policy.
    return isPlainObject(value) ? value as RoutePolicy : undefined;
  }

  const result: Record<string, unknown> = {};
  for (const property of asNodeArray(node.properties)) {
    if (property.type !== "Property" || property.computed) return undefined;
    const name = propertyName(property.key);
    const valueNode = asNode(property.value);
    if (!name || !valueNode) return undefined;

    if (name === "document") {
      const document = extractSecurityPolicy(valueNode, imports, constants);
      if (!document) return undefined;
      result.document = document;
      continue;
    }

    const value = evaluateLiteral(valueNode, constants);
    if (value === unresolved) return undefined;
    result[name] = value;
  }

  // TYPE-EVIDENCE: the loop above copied each property from the object expression. The cast labels the accumulated record as a route policy.
  return result as RoutePolicy;
}

function extractSecurityPolicy(
  node: AstNode,
  imports: Map<string, string>,
  constants: Map<string, unknown>,
): SecurityPolicy | undefined {
  if (node.type !== "CallExpression") {
    const value = evaluateLiteral(node, constants);
    // TYPE-EVIDENCE: the isPlainObject check confirms the value is a plain object. The cast labels it as a security policy.
    return isPlainObject(value) ? value as SecurityPolicy : undefined;
  }

  const callee = asNode(node.callee);
  if (callee?.type !== "MemberExpression") return undefined;
  const objectName = identifierName(callee.object);
  const preset = propertyName(callee.property);
  if (!objectName || imports.get(objectName) !== "security" || !preset) {
    return undefined;
  }

  const options = evaluateLiteral(asNodeArray(node.arguments)[0], constants);
  // The options expression could not be statically evaluated (it depends on
  // a runtime value). The `unresolved` sentinel must not pass through to a
  // security preset because it would verify a policy that was never computed.
  // Treat this call as unverifiable, matching `unresolved` handling in
  // extractRoutePolicy above.
  if (options === unresolved) return undefined;
  if (options !== undefined && !isPlainObject(options)) {
    return undefined;
  }

  if (preset === "api") {
    // TYPE-EVIDENCE: the guards above return undefined unless options is a plain object or undefined. The cast labels the record as a security policy for the preset helper.
    return security.api(options as SecurityPolicy | undefined);
  }
  if (preset === "crossOriginIsolated") {
    // TYPE-EVIDENCE: the guards above return undefined unless options is a plain object or undefined. The cast labels the record as a security policy for the preset helper.
    return security.crossOriginIsolated(options as SecurityPolicy | undefined);
  }
  if (preset === "static") {
    // TYPE-EVIDENCE: the guards above return undefined unless options is a plain object or undefined. The cast labels the record as a security policy for the preset helper.
    return security.static(options as SecurityPolicy | undefined);
  }
  if (preset === "strict") {
    // TYPE-EVIDENCE: the guards above return undefined unless options is a plain object or undefined. The cast labels the record as a security policy for the preset helper.
    return security.strict(options as SecurityPolicy | undefined);
  }
  return undefined;
}

function validateExtractedRouteModule(
  routeModule: ExtractedRouteModule,
  file: string,
) {
  const findings: StaticPolicyFinding[] = [];
  const availableMethods = new Set(routeModule.declaredMethods);
  if (availableMethods.has("GET")) availableMethods.add("HEAD");
  // Demiurge answers preflight itself, so a route never exports an OPTIONS
  // capability to serve one. Listing OPTIONS is a habit carried in from other
  // CORS configuration, and rejecting it would fail a build over nothing.
  availableMethods.add("OPTIONS");

  // TYPE-EVIDENCE: Object.entries returns the capability map entries as string keyed pairs. The cast narrows the keys to HTTP methods and the values to capability types.
  for (const [exportName, capability] of Object.entries(
    routeModule.capabilities,
  ) as Array<[HttpMethod, ExtractedCapability]>) {
    if (capability.cors) {
      try {
        validateCorsPolicy(capability.cors);
      } catch (error) {
        findings.push(finding(
          "cors-invalid",
          file,
          errorMessage(error, "The CORS policy is invalid."),
          exportName,
        ));
      }

      for (const method of capability.cors.methods ?? []) {
        if (!availableMethods.has(method)) {
          findings.push(finding(
            "cors-method-unavailable",
            file,
            `CORS method ${method} is not available from this route.`,
            exportName,
          ));
        }
      }
    }

    validateRateLimit(capability.security, file, exportName, findings);
  }

  validateRateLimit(routeModule.policy?.security, file, undefined, findings);
  if (routeModule.policy?.document) {
    try {
      createSecurityHeaders(toFragmentDocument(routeModule.policy.document), {
        nonce: "build-verification-nonce",
      });
    } catch (error) {
      findings.push(finding(
        "security-header-render-failed",
        file,
        errorMessage(error, "The security headers are invalid."),
      ));
    }
  }

  return findings;
}

// A build reads one file at a time, but policy cascades. A file declaring no
// reporting endpoints of its own inherits them. Its `csp.reportTo` therefore
// names a group only the merged policy resolves, which
// `validateRouteModules(...)` checks during startup. A file declaring its own
// endpoint map is self-contained. A name outside that map stays a build
// error, because that is the typo worth catching early.
function toFragmentDocument(document: SecurityPolicy): SecurityPolicy {
  const endpoints = document.headers?.reportingEndpoints;
  const declaresEndpoints = Boolean(
    endpoints && Object.keys(endpoints).length,
  );
  const reportTo = document.csp === false ? undefined : document.csp?.reportTo;

  if (declaresEndpoints || !reportTo) {
    return document;
  }

  // TYPE-EVIDENCE: the guard above returns early when the csp field is false or missing. The remaining value is therefore a policy object.
  return {
    ...document,
    csp: { ...document.csp as ContentSecurityPolicy, reportTo: undefined },
    headers: endpoints
      ? { ...document.headers, reportingEndpoints: undefined }
      : document.headers,
  };
}

function validateRateLimit(
  securityPolicy: RouteSecurityPolicy | undefined,
  file: string,
  exportName: string | undefined,
  findings: StaticPolicyFinding[],
) {
  if (!securityPolicy?.rateLimit) return;
  try {
    validateRateLimitPolicy(securityPolicy.rateLimit);
  } catch (error) {
    findings.push(finding(
      "rate-limit-invalid",
      file,
      errorMessage(error, "The rate limit policy is invalid."),
      exportName,
    ));
  }
}

function finding(
  code: StaticPolicyFinding["code"],
  file: string,
  message: string,
  exportName?: string,
): StaticPolicyFinding {
  return { code, exportName, file, message, severity: "error" };
}

function collectCoreImports(ast: AstNode) {
  const imports = new Map<string, string>();
  for (const statement of asNodeArray(ast.body)) {
    if (
      statement.type !== "ImportDeclaration" ||
      asNode(statement.source)?.value !== "@demiurgejs/core"
    ) continue;
    for (const specifier of asNodeArray(statement.specifiers)) {
      if (specifier.type !== "ImportSpecifier") continue;
      const local = identifierName(specifier.local);
      const imported = propertyName(specifier.imported);
      if (local && imported) imports.set(local, imported);
    }
  }
  return imports;
}

function collectConstants(ast: AstNode) {
  const constants = new Map<string, unknown>();
  for (const statement of asNodeArray(ast.body)) {
    const declaration = statement.type === "ExportNamedDeclaration"
      ? asNode(statement.declaration)
      : statement;
    if (declaration?.type !== "VariableDeclaration") continue;
    for (const declarator of asNodeArray(declaration.declarations)) {
      const name = identifierName(declarator.id);
      const initializer = asNode(declarator.init);
      if (!name || !initializer) continue;
      const value = evaluateLiteral(initializer, constants);
      if (value !== unresolved) constants.set(name, value);
    }
  }
  return constants;
}

const unresolved = Symbol("unresolved");

function evaluateLiteral(
  node: AstNode | undefined,
  constants: Map<string, unknown>,
): unknown | typeof unresolved {
  if (!node) return undefined;
  if (node.type === "Literal") return node.value;
  if (node.type === "Identifier") {
    if (node.name === "undefined") return undefined;
    return constants.has(String(node.name))
      ? constants.get(String(node.name))
      : unresolved;
  }
  if (node.type === "TemplateLiteral") {
    if (asNodeArray(node.expressions).length) return unresolved;
    return asNodeArray(node.quasis)
      .map((quasi) => asNode(quasi.value)?.cooked ?? "")
      .join("");
  }
  if (node.type === "UnaryExpression") {
    const value = evaluateLiteral(asNode(node.argument), constants);
    if (typeof value !== "number") return unresolved;
    if (node.operator === "-") return -value;
    if (node.operator === "+") return value;
    return unresolved;
  }
  if (node.type === "ArrayExpression") {
    const values: unknown[] = [];
    for (const element of asNodeArray(node.elements)) {
      const value = evaluateLiteral(element, constants);
      if (value === unresolved) return unresolved;
      values.push(value);
    }
    return values;
  }
  if (node.type === "ObjectExpression") {
    const value: Record<string, unknown> = {};
    for (const property of asNodeArray(node.properties)) {
      if (property.type !== "Property" || property.computed) return unresolved;
      const name = propertyName(property.key);
      const child = evaluateLiteral(asNode(property.value), constants);
      if (!name || child === unresolved) return unresolved;
      value[name] = child;
    }
    return value;
  }
  return unresolved;
}

function isHttpMethod(value: string): value is HttpMethod {
  // TYPE-EVIDENCE: the value is a string that the includes check tests against the HTTP methods tuple. The cast narrows it for the check.
  return httpMethods.includes(value as HttpMethod);
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function asNode(value: unknown) {
  // TYPE-EVIDENCE: the type in value check confirms the value is an AST node. The cast asserts that node shape.
  return value && typeof value === "object" && "type" in value
    ? value as AstNode
    : undefined;
}

function asNodeArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(asNode).filter((node): node is AstNode => Boolean(node))
    : [];
}

function identifierName(value: unknown) {
  const node = asNode(value);
  return node?.type === "Identifier" ? String(node.name) : undefined;
}

function propertyName(value: unknown) {
  const node = asNode(value);
  return node?.type === "Identifier" || node?.type === "Literal"
    ? String(node.name ?? node.value)
    : undefined;
}
