import { noChainedTypeAssertions } from "./rules/no-chained-type-assertions.js";
import { requireSafetyCommentForTypeAssertion } from "./rules/require-safety-comment-for-type-assertion.js";
import { noUnsafeDictionaryType } from "./rules/no-unsafe-dictionary-type.js";

export { noChainedTypeAssertions, requireSafetyCommentForTypeAssertion, noUnsafeDictionaryType };

const plugin = {
  rules: {
    "no-chained-type-assertions": noChainedTypeAssertions,
    "require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertion,
    "no-unsafe-dictionary-type": noUnsafeDictionaryType,
  },
};

export default plugin;
