const COMMENT_OWNER_KINDS = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
]);

function isConstAssertion(node) {
  return (
    node.typeAnnotation !== null &&
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName !== null &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function hasTypeEvidenceComment(sourceCode, node) {
  let current = node;
  while (true) {
    const hasComment = sourceCode
      .getCommentsBefore(current)
      .some(
        (comment) => comment.range[1] <= node.range[0] && /\bTYPE-EVIDENCE\s*:/u.test(comment.value),
      );
    if (hasComment) return true;
    if (COMMENT_OWNER_KINDS.has(current.type) || current.parent.type === "Program") {
      return false;
    }
    current = current.parent;
  }
}

export const requireSafetyCommentForTypeAssertion = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby TYPE-EVIDENCE comment for every TypeScript type assertion except const assertions.",
    },
    messages: {
      missingTypeEvidenceComment:
        "This type assertion has no TYPE-EVIDENCE justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
    schema: [],
  },
  create(context) {
    const check = (node) => {
      if (isConstAssertion(node) || hasTypeEvidenceComment(context.sourceCode, node)) {
        return;
      }
      context.report({ node, messageId: "missingTypeEvidenceComment" });
    };
    return {
      TSAsExpression: check,
      TSTypeAssertion: check,
    };
  },
};
