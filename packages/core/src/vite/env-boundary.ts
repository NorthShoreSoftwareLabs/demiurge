import { parseAst } from "vite";
import type { EnvSchema } from "../security/env";

type AstNode = {
  [key: string]: unknown;
  end: number;
  start: number;
  type: string;
};

export type EnvBoundaryFinding = {
  code: "client-secret" | "client-server-only";
  importPath: string[];
  key: string;
  module: string;
};

// The build inlines a client variable in the browser bundle. Every other
// declared variable stays on the server. This module finds the modules that
// the client entry reaches and that read a variable of the second group.
export function findServerEnvKeys(schema: EnvSchema | undefined) {
  const keys = new Map<string, { sensitive: boolean }>();

  for (const [key, variable] of Object.entries(schema ?? {})) {
    if (variable.client) continue;
    keys.set(key, { sensitive: variable.sensitive });
  }

  return keys;
}

// A module reads a variable when it names the variable in a position that
// gives a value. An object key that declares the schema is not such a
// position, and neither is the local name of an import.
export function findEnvKeyReferences(
  code: string,
  keys: Iterable<string>,
): string[] {
  const names = new Set(keys);
  const found = new Set<string>();

  if (!names.size) return [];
  // A text test keeps the build away from a parse that finds nothing.
  if (![...names].some((name) => code.includes(name))) return [];

  visitNode(asAstNode(parseAst(code)), names, found);

  return [...found].sort();
}

// The diagnostic gives the path that makes the module part of the browser
// bundle. The search returns the shortest such path.
export function findImportPath(
  entry: string,
  target: string,
  importsOf: (id: string) => readonly string[],
): string[] | undefined {
  if (entry === target) return [entry];

  const visited = new Set([entry]);
  const queue: string[][] = [[entry]];

  while (queue.length) {
    // TYPE-EVIDENCE: the loop condition proves the queue holds a path. The assertion reads that path.
    const path = queue.shift() as string[];

    for (const next of importsOf(path[path.length - 1])) {
      if (visited.has(next)) continue;
      if (next === target) return [...path, next];
      visited.add(next);
      queue.push([...path, next]);
    }
  }

  return undefined;
}

export function formatEnvBoundaryFindings(findings: EnvBoundaryFinding[]) {
  return [
    "Demiurge stopped the build. Client code reads an environment variable that stays on the server.",
    "",
    ...findings.flatMap(formatEnvBoundaryFinding),
  ].join("\n");
}

function formatEnvBoundaryFinding(finding: EnvBoundaryFinding) {
  return [
    `  variable: ${finding.key}`,
    `  module: ${finding.module}`,
    `  import path: ${finding.importPath.join(" -> ")}`,
    finding.code === "client-secret"
      ? "  A secret variable never reaches the browser. Read the value on the server, then send the result through route data."
      : "  Declare the variable with client: true to put the value in the browser bundle.",
    "",
  ];
}

function visitNode(node: AstNode, names: Set<string>, found: Set<string>) {
  if (node.type === "ImportDeclaration") return;
  if (node.type === "ExportNamedDeclaration" && !node.declaration) return;
  if (node.type === "ExportAllDeclaration") return;

  if (node.type === "Identifier") {
    match(node.name, names, found);
    return;
  }

  if (node.type === "MemberExpression") {
    visitValue(node.object, names, found);
    visitKey(node.property, Boolean(node.computed), names, found);
    return;
  }

  if (node.type === "Property" || node.type === "PropertyDefinition") {
    // A destructured name reads the value. An object key declares a name.
    if (node.computed || isPatternProperty(node)) {
      visitKey(node.key, Boolean(node.computed), names, found);
    }
    visitValue(node.value, names, found);
    return;
  }

  visitOwnChildren(node, names, found);
}

// A pattern property holds a read of the value. The parser gives such a
// property a pattern node or an identifier as its value.
function isPatternProperty(node: AstNode) {
  const value = asNode(node.value);
  return value?.type === "Identifier" || value?.type === "ObjectPattern" ||
    value?.type === "ArrayPattern" || value?.type === "AssignmentPattern";
}

function visitKey(
  value: unknown,
  computed: boolean,
  names: Set<string>,
  found: Set<string>,
) {
  const key = asNode(value);
  if (!key) return;

  if (key.type === "Literal") {
    match(key.value, names, found);
    return;
  }

  if (!computed) {
    if (key.type === "Identifier") match(key.name, names, found);
    return;
  }

  visitValue(key, names, found);
}

function match(value: unknown, names: Set<string>, found: Set<string>) {
  if (typeof value === "string" && names.has(value)) found.add(value);
}

function visitOwnChildren(
  node: AstNode,
  names: Set<string>,
  found: Set<string>,
) {
  for (const [key, child] of Object.entries(node)) {
    if (key === "end" || key === "loc" || key === "start" || key === "type") {
      continue;
    }
    visitValue(child, names, found);
  }
}

function visitValue(value: unknown, names: Set<string>, found: Set<string>) {
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    for (const item of value) visitValue(item, names, found);
    return;
  }

  const node = asNode(value);
  if (node) {
    visitNode(node, names, found);
    return;
  }

  // TYPE-EVIDENCE: the value was checked to be an object without a node type. The cast reads its members.
  for (const child of Object.values(value as Record<string, unknown>)) {
    visitValue(child, names, found);
  }
}

function asNode(value: unknown) {
  // TYPE-EVIDENCE: the type in value check confirms the value is an AST node. The cast asserts that node shape.
  return value && typeof value === "object" && "type" in value &&
      typeof (value as { type: unknown }).type === "string"
    ? value as AstNode
    : undefined;
}

// TYPE-EVIDENCE: rollup returns a generic program node. The local type is a loose access shape.
function asAstNode(value: unknown): AstNode {
  // TYPE-EVIDENCE: the caller passes a rollup program node. The cast labels it with the loose access shape.
  return value as AstNode;
}
