import type { Rule } from "eslint";

export declare const noChainedTypeAssertions: Rule.RuleModule;
export declare const requireSafetyCommentForTypeAssertion: Rule.RuleModule;
export declare const noUnsafeDictionaryType: Rule.RuleModule;

declare const plugin: {
  rules: {
    "no-chained-type-assertions": Rule.RuleModule;
    "require-safety-comment-for-type-assertion": Rule.RuleModule;
    "no-unsafe-dictionary-type": Rule.RuleModule;
  };
};

export default plugin;
