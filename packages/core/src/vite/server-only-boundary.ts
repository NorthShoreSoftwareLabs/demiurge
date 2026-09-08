import { parseAst } from "vite";

type AstNode = {
  [key: string]: unknown;
  end: number;
  start: number;
  type: string;
};

export type ServerOnlyBoundaryFinding = {
  importPath: string[];
  module: string;
};

// A module that imports one of these specifiers declares that a build must
// keep it off the browser. The community package server-only uses the same
// bare specifier, so an application that already uses that package keeps the
// same protection under Demiurge.
const serverOnlyMarkerSpecifiers = new Set([
  "@demiurgejs/core/server-only",
  "server-only",
]);

// A module imports the marker through a static import, a re-export, or a
// dynamic import. A text test keeps the build away from a parse that finds
// nothing.
export function importsServerOnlyMarker(code: string): boolean {
  if (!code.includes("server-only")) return false;

  return findsMarkerImport(asAstNode(parseAst(code)));
}

export function formatServerOnlyBoundaryFindings(
  findings: ServerOnlyBoundaryFinding[],
) {
  return [
    "Demiurge stopped the build. A browser bundle reaches a module marked server-only.",
    "",
    ...findings.flatMap(formatServerOnlyBoundaryFinding),
  ].join("\n");
}

// The development server transforms a browser request before it can find the
// import path from a client entry. The message names the module and the
// repair instead.
export function formatServerOnlyDevError(module: string) {
  return `Demiurge stopped the development server. The browser requested ${module}, and this module is marked server-only.

Keep this module out of client code. Move the server logic to a module that no client module imports.`;
}

function formatServerOnlyBoundaryFinding(finding: ServerOnlyBoundaryFinding) {
  return [
    `  module: ${finding.module}`,
    `  import path: ${finding.importPath.join(" -> ")}`,
    "  Keep this module out of client code. Move the server logic to a module that no client module imports.",
    "",
  ];
}

function findsMarkerImport(ast: AstNode): boolean {
  let found = false;

  walkAst(ast, (node) => {
    if (found) return;

    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration" ||
        node.type === "ImportExpression") &&
      isMarkerSource(node.source)
    ) {
      found = true;
    }
  });

  return found;
}

function isMarkerSource(value: unknown): boolean {
  const node = asNode(value);
  return node?.type === "Literal" &&
    typeof node.value === "string" &&
    serverOnlyMarkerSpecifiers.has(node.value);
}

function walkAst(value: unknown, visit: (node: AstNode) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkAst(item, visit);
    return;
  }

  // TYPE-EVIDENCE: the value was checked to be an object. The cast adds the loose AST node shape.
  const node = value as Partial<AstNode>;
  if (typeof node.type !== "string") return;
  // TYPE-EVIDENCE: the type field check above confirms the value is an AST node. The cast asserts that node shape.
  visit(node as AstNode);
  for (const [key, child] of Object.entries(node)) {
    if (!new Set(["end", "loc", "start", "type"]).has(key)) {
      walkAst(child, visit);
    }
  }
}

function asNode(value: unknown) {
  // TYPE-EVIDENCE: the type in value check confirms the value is an AST node. The cast asserts that node shape.
  return value && typeof value === "object" && "type" in value
    ? value as AstNode
    : undefined;
}

// TYPE-EVIDENCE: rollup returns a generic program node. The local type is a loose access shape.
function asAstNode(value: unknown): AstNode {
  // TYPE-EVIDENCE: the caller passes a rollup program node. The cast labels it with the loose access shape.
  return value as AstNode;
}
