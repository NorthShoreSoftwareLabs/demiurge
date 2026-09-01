import { readFile } from "node:fs/promises";
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
  code: "cors-invalid" | "cors-method-unavailable" | "rate-limit-invalid" |
    "security-header-render-failed";
  exportName?: string;
  file: string;
  message: string;
  severity: "error";
};

type ExtractedCapability = {
  cors?: CorsPolicy;
  security?: RouteSecurityPolicy;
};

type ExtractedRouteModule = {
  capabilities: Partial<Record<HttpMethod, ExtractedCapability>>;
  declaredMethods: Set<HttpMethod>;
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
  const source = await readFile(file, "utf8");
  return await verifyRoutePolicySource(source, file);
}

export async function verifyRoutePolicySource(source: string, file: string) {
  const loader = file.endsWith(".tsx") ? "tsx" : "ts";
  const transformed = await transformWithEsbuild(source, file, {
    format: "esm",
    loader,
    target: "esnext",
  });
  const extracted = extractRouteModule(transformed.code);

  return validateExtractedRouteModule(extracted, file);
}

function extractRouteModule(code: string): ExtractedRouteModule {
  const ast = asAstNode(parseAst(code));
  const imports = collectCoreImports(ast);
  const constants = collectConstants(ast);
  const declarations = collectVariableInitializers(ast);
  const exports = collectNamedExports(ast);
  const capabilities: ExtractedRouteModule["capabilities"] = {};
  const declaredMethods = new Set<HttpMethod>();
  let policy: RoutePolicy | undefined;

  for (const [exportName, localName] of exports) {
    const initializer = declarations.get(localName);

    if (exportName === "policy") {
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

  return { capabilities, declaredMethods, policy };
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
