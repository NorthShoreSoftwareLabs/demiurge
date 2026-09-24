import { parseAst, transformWithEsbuild } from "vite";

type AstNode = {
  [key: string]: unknown;
  end: number;
  start: number;
  type: string;
};

export type DocumentResource = {
  file: string;
  kind:
    | "external-script"
    | "external-stylesheet"
    | "inline-script"
    | "inline-style"
    | "style-import";
  nonce?: string;
  nonceUnknown?: true;
  value: string;
};

export async function extractDocumentResources(
  source: string,
  file: string,
): Promise<DocumentResource[]> {
  if (!file.endsWith(".tsx")) return [];

  const transformed = await transformWithEsbuild(source, file, {
    format: "esm",
    loader: "tsx",
    target: "esnext",
  });
  const ast = asAstNode(parseAst(transformed.code));
  const jsxFactories = collectJsxFactories(ast);
  const resources: DocumentResource[] = [];

  visit(ast, (node) => {
    if (node.type !== "CallExpression") return;
    if (!isElementFactory(node.callee, jsxFactories)) return;

    const [tagNode, propsNode, childNode] = nodeArray(node.arguments);
    const tag = literalText(tagNode);
    if (!tag || !["link", "script", "style"].includes(tag)) return;

    const props = propsNode?.type === "ObjectExpression"
      ? literalProps(propsNode)
      : propsNode?.type === "Literal" && propsNode.value === null
      ? new Map<string, AstNode>()
      : undefined;
    if (!props) return;
    const children = props.get("children") ?? childNode;

    if (tag === "script") {
      const src = literalText(props.get("src"));
      if (src !== undefined) {
        resources.push({
          file,
          kind: "external-script",
          ...literalNonce(props),
          value: src,
        });
        return;
      }

      const content = literalText(children);
      if (content !== undefined) {
        resources.push({
          file,
          kind: "inline-script",
          ...literalNonce(props),
          value: content,
        });
      }
      return;
    }

    if (tag === "link") {
      const rel = literalText(props.get("rel"));
      const href = literalText(props.get("href"));
      if (
        href !== undefined && rel?.split(/\s+/).some((item) =>
          item.toLowerCase() === "stylesheet"
        )
      ) {
        resources.push({ file, kind: "external-stylesheet", value: href });
      }
      return;
    }

    const content = literalText(children);
    if (content === undefined) return;
    resources.push({
      file,
      kind: "inline-style",
      ...literalNonce(props),
      value: content,
    });
    for (const value of findStyleImports(content)) {
      resources.push({ file, kind: "style-import", value });
    }
  });

  return resources;
}

function literalNonce(props: Map<string, AstNode>) {
  const nonce = props.get("nonce");
  if (!nonce) return {};
  const value = literalText(nonce);
  return value === undefined ? { nonceUnknown: true as const } : { nonce: value };
}

function isElementFactory(value: unknown, jsxFactories: Set<string>) {
  const node = asNode(value);
  const identifier = identifierName(node);
  if (identifier && jsxFactories.has(identifier)) return true;
  if (node?.type !== "MemberExpression" || node.computed) return false;

  return identifierName(node.object) === "React" &&
    identifierName(node.property) === "createElement";
}

function collectJsxFactories(ast: AstNode) {
  const factories = new Set<string>();

  for (const statement of nodeArray(ast.body)) {
    if (statement.type !== "ImportDeclaration") continue;
    if (literalText(asNode(statement.source)) !== "react/jsx-runtime") continue;

    for (const specifier of nodeArray(statement.specifiers)) {
      if (specifier.type !== "ImportSpecifier") continue;
      const imported = identifierName(specifier.imported);
      const local = identifierName(specifier.local);
      if ((imported === "jsx" || imported === "jsxs") && local) {
        factories.add(local);
      }
    }
  }

  return factories;
}

function literalProps(node: AstNode) {
  const props = new Map<string, AstNode>();

  for (const property of nodeArray(node.properties)) {
    if (property.type !== "Property" || property.computed) return undefined;
    const name = propertyName(property.key);
    const value = asNode(property.value);
    if (!name || !value) return undefined;
    props.set(name, value);
  }

  return props;
}

function literalText(node: AstNode | undefined): string | undefined {
  if (!node) return undefined;
  if (node.type === "Literal") {
    return typeof node.value === "string" ? node.value : undefined;
  }
  if (node.type !== "TemplateLiteral") return undefined;
  if (nodeArray(node.expressions).length !== 0) return undefined;

  const quasi = nodeArray(node.quasis)[0];
  const value = quasi?.value;
  if (!value || typeof value !== "object") return undefined;
  const cooked = Reflect.get(value, "cooked");
  const raw = Reflect.get(value, "raw");
  return typeof cooked === "string"
    ? cooked
    : typeof raw === "string"
    ? raw
    : undefined;
}

function findStyleImports(css: string) {
  const imports: string[] = [];
  let blockDepth = 0;

  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    const next = css[index + 1];

    if (character === "/" && next === "*") {
      index = skipCssComment(css, index + 2);
      continue;
    }
    if (character === '"' || character === "'") {
      index = skipCssString(css, index + 1, character);
      continue;
    }
    if (character === "{") {
      blockDepth += 1;
      continue;
    }
    if (character === "}") {
      blockDepth = Math.max(0, blockDepth - 1);
      continue;
    }
    if (blockDepth !== 0 || !css.slice(index).match(/^@import\b/i)) {
      continue;
    }

    const match = /^@import(?:\s|\/\*[\s\S]*?\*\/)+(?:url\(\s*(?:(["'])(.*?)\1|([^\s)'";]+))\s*\)|(["'])(.*?)\4)/i.exec(
      css.slice(index),
    );
    const value = match?.[2] ?? match?.[3] ?? match?.[5];
    const matchedText = match?.[0];
    if (value !== undefined && matchedText !== undefined) {
      imports.push(value);
      index += matchedText.length - 1;
    }
  }

  return imports;
}

function skipCssComment(css: string, start: number) {
  const end = css.indexOf("*/", start);
  return end === -1 ? css.length : end + 1;
}

function skipCssString(css: string, start: number, quote: string) {
  for (let index = start; index < css.length; index += 1) {
    if (css[index] === "\\") {
      index += 1;
      continue;
    }
    if (css[index] === quote) {
      return index;
    }
  }
  return css.length;
}

function visit(node: AstNode, callback: (node: AstNode) => void) {
  callback(node);

  for (const [key, value] of Object.entries(node)) {
    if (key === "end" || key === "loc" || key === "start" || key === "type") {
      continue;
    }
    visitValue(value, callback);
  }
}

function visitValue(value: unknown, callback: (node: AstNode) => void) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) visitValue(item, callback);
    return;
  }
  if (isAstNode(value)) visit(value, callback);
}

function propertyName(value: unknown) {
  const node = asNode(value);
  if (node?.type === "Identifier") return String(node.name);
  return literalText(node);
}

function identifierName(value: unknown) {
  const node = asNode(value);
  return node?.type === "Identifier" ? String(node.name) : undefined;
}

function nodeArray(value: unknown): AstNode[] {
  return Array.isArray(value) ? value.filter(isAstNode) : [];
}

function asNode(value: unknown) {
  return isAstNode(value) ? value : undefined;
}

function isAstNode(value: unknown): value is AstNode {
  return Boolean(
    value && typeof value === "object" &&
      typeof Reflect.get(value, "type") === "string",
  );
}

// TYPE-EVIDENCE: Rollup returns a generic program node. The local type is a loose access shape.
function asAstNode(value: unknown): AstNode {
  // TYPE-EVIDENCE: The caller passes a Rollup program node. The cast labels it with the loose access shape.
  return value as AstNode;
}
