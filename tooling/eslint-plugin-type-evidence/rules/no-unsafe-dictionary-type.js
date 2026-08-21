const TRANSPARENT_WRAPPERS = new Set(["Readonly", "Partial", "Required", "NonNullable"]);

const TYPE_NODE_KINDS = new Set([
  "TSAnyKeyword",
  "TSArrayType",
  "TSBigIntKeyword",
  "TSBooleanKeyword",
  "TSConditionalType",
  "TSConstructorType",
  "TSFunctionType",
  "TSImportType",
  "TSIndexedAccessType",
  "TSInferType",
  "TSIntersectionType",
  "TSIntrinsicKeyword",
  "TSLiteralType",
  "TSMappedType",
  "TSNamedTupleMember",
  "TSNeverKeyword",
  "TSNullKeyword",
  "TSNumberKeyword",
  "TSObjectKeyword",
  "TSParenthesizedType",
  "TSStringKeyword",
  "TSSymbolKeyword",
  "TSTemplateLiteralType",
  "TSThisType",
  "TSTupleType",
  "TSTypeLiteral",
  "TSTypeOperator",
  "TSTypePredicate",
  "TSTypeQuery",
  "TSTypeReference",
  "TSUndefinedKeyword",
  "TSUnionType",
  "TSUnknownKeyword",
  "TSVoidKeyword",
]);

function isTypeNode(node) {
  return node !== null && TYPE_NODE_KINDS.has(node.type);
}

function typeReferenceName(type) {
  return type.typeName.type === "Identifier" ? type.typeName.name : null;
}

function collectAliases(program) {
  const aliases = new Map();
  for (const statement of program.body) {
    let declaration = statement;
    if (
      declaration.type === "ExportNamedDeclaration" ||
      declaration.type === "ExportDefaultDeclaration"
    ) {
      declaration = declaration.declaration ?? null;
    }
    if (declaration !== null && declaration.type === "TSTypeAliasDeclaration") {
      aliases.set(declaration.id.name, declaration.typeAnnotation);
    }
  }
  return aliases;
}

function unwrapTransparentType(type) {
  let current = type;
  while (
    current.type === "TSParenthesizedType" ||
    (current.type === "TSTypeOperator" && current.operator === "readonly")
  ) {
    current = current.typeAnnotation;
  }
  return current;
}

function unsafeDirectValue(type, aliases, resolving) {
  const unwrapped = unwrapTransparentType(type);
  switch (unwrapped.type) {
    case "TSAnyKeyword":
      return "any";
    case "TSObjectKeyword":
      return "object";
    case "TSTypeLiteral":
      return unwrapped.members.length === 0 ? "empty-object" : null;
    case "TSUnionType":
      return unwrapped.types.some((member) => unsafeDirectValue(member, aliases, resolving) !== null)
        ? "union"
        : null;
    case "TSIntersectionType": {
      const members = unwrapped.types.map((member) => unsafeDirectValue(member, aliases, resolving));
      if (members.includes("any")) return "any";
      return members.length > 0 && members.every((member) => member !== null) ? members[0] : null;
    }
    case "TSTypeReference": {
      const name = typeReferenceName(unwrapped);
      if (name === null) return null;
      if (TRANSPARENT_WRAPPERS.has(name)) {
        const wrapped = unwrapped.typeArguments?.params[0];
        return wrapped === undefined ? null : unsafeDirectValue(wrapped, aliases, resolving);
      }
      const alias = aliases.get(name);
      if (alias === undefined || resolving.has(name)) return null;
      const next = new Set(resolving);
      next.add(name);
      return unsafeDirectValue(alias, aliases, next);
    }
    default:
      return null;
  }
}

function dictionaryValueType(type, aliases, resolving) {
  const unwrapped = unwrapTransparentType(type);
  if (unwrapped.type === "TSTypeLiteral") {
    const indexSignature = unwrapped.members.find((member) => member.type === "TSIndexSignature");
    return indexSignature !== undefined && indexSignature.typeAnnotation !== null
      ? indexSignature.typeAnnotation.typeAnnotation
      : null;
  }
  if (unwrapped.type === "TSMappedType") {
    return unwrapped.typeAnnotation ?? null;
  }
  if (unwrapped.type !== "TSTypeReference") return null;
  const name = typeReferenceName(unwrapped);
  if (name === null) return null;
  if (name === "Record") {
    return unwrapped.typeArguments?.params[1] ?? null;
  }
  if (TRANSPARENT_WRAPPERS.has(name)) {
    const wrapped = unwrapped.typeArguments?.params[0];
    return wrapped === undefined ? null : dictionaryValueType(wrapped, aliases, resolving);
  }
  const alias = aliases.get(name);
  if (alias === undefined || resolving.has(name)) return null;
  const next = new Set(resolving);
  next.add(name);
  return dictionaryValueType(alias, aliases, next);
}

function classifyUnsafeDictionary(type, aliases) {
  const valueType = dictionaryValueType(type, aliases, new Set());
  if (valueType === null) return null;
  const unsafeValue = unsafeDirectValue(valueType, aliases, new Set());
  return unsafeValue === null ? null : { unsafeValue };
}

function isInsideTypeAliasDeclaration(node) {
  let current = node.parent;
  while (current !== null && current.type !== "Program") {
    if (current.type === "TSTypeAliasDeclaration") return true;
    current = current.parent;
  }
  return false;
}

function isPlainAliasConsumerUse(node, aliases) {
  if (node.type !== "TSTypeReference" || (node.typeArguments?.params.length ?? 0) > 0) {
    return false;
  }
  const name = typeReferenceName(node);
  return name !== null && aliases.has(name) && !isInsideTypeAliasDeclaration(node);
}

function shouldReport(node, aliases) {
  if (isPlainAliasConsumerUse(node, aliases)) return false;
  if (classifyUnsafeDictionary(node, aliases) === null) return false;
  let current = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isTypeNode(current) && classifyUnsafeDictionary(current, aliases) !== null) {
      return false;
    }
    current = current.parent;
  }
  return true;
}

export const noUnsafeDictionaryType = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow object-dictionary contracts whose direct value type is any, object, or {}.",
    },
    messages: {
      unsafeDictionary:
        "This dictionary value type silently discards the value contract. Use an owner or schema-derived value type. Parse external payloads before insertion.",
    },
    schema: [],
  },
  create(context) {
    let aliases = new Map();
    return {
      Program(node) {
        aliases = collectAliases(node);
      },
      TSTypeReference(node) {
        if (!shouldReport(node, aliases)) return;
        const unsafe = classifyUnsafeDictionary(node, aliases);
        context.report({ node, messageId: "unsafeDictionary", data: { value: unsafe.unsafeValue } });
      },
      TSTypeLiteral(node) {
        if (!shouldReport(node, aliases)) return;
        const unsafe = classifyUnsafeDictionary(node, aliases);
        context.report({ node, messageId: "unsafeDictionary", data: { value: unsafe.unsafeValue } });
      },
      TSMappedType(node) {
        if (!shouldReport(node, aliases)) return;
        const unsafe = classifyUnsafeDictionary(node, aliases);
        context.report({ node, messageId: "unsafeDictionary", data: { value: unsafe.unsafeValue } });
      },
      TSIndexSignature(node) {
        if (node.typeAnnotation === null || node.parent.type === "TSTypeLiteral") return;
        const unsafe = unsafeDirectValue(node.typeAnnotation.typeAnnotation, aliases, new Set());
        if (unsafe !== null) {
          context.report({ node, messageId: "unsafeDictionary", data: { value: unsafe } });
        }
      },
    };
  },
};
