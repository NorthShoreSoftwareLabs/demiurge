const ASSERTION_TYPES = new Set(["TSAsExpression", "TSTypeAssertion"]);

function isTypeAssertion(node) {
  return node !== null && ASSERTION_TYPES.has(node.type);
}

function unwrapParenthesized(node) {
  let current = node;
  while (current.type === "ParenthesizedExpression") {
    current = current.expression;
  }
  return current;
}

function isConstAssertion(node) {
  return (
    node.typeAnnotation !== null &&
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName !== null &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

function isOutermostAssertionInChain(node) {
  let current = node;
  let parent = node.parent;
  while (
    parent !== null &&
    parent.type === "ParenthesizedExpression" &&
    parent.expression === current
  ) {
    current = parent;
    parent = parent.parent;
  }
  return !isTypeAssertion(parent) || parent.expression !== current;
}

function isForbiddenChain(node) {
  let count = 0;
  let hasNonConstAssertion = false;
  let current = node;
  while (isTypeAssertion(current)) {
    count += 1;
    hasNonConstAssertion = hasNonConstAssertion || !isConstAssertion(current);
    current = unwrapParenthesized(current.expression);
  }
  return count > 1 && hasNonConstAssertion;
}

export const noChainedTypeAssertions = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow chained TypeScript as and angle-bracket assertions, including parenthesized chains.",
    },
    messages: {
      chained:
        "This assertion chain discards type evidence. Keep the original type or parse untrusted input at its boundary.",
    },
    schema: [],
  },
  create(context) {
    const check = (node) => {
      if (isOutermostAssertionInChain(node) && isForbiddenChain(node)) {
        context.report({ node, messageId: "chained" });
      }
    };
    return {
      TSAsExpression: check,
      TSTypeAssertion: check,
    };
  },
};
