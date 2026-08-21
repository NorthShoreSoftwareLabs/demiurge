import { Linter, type Rule } from "eslint";
import tseslint from "typescript-eslint";
import {
  noChainedTypeAssertions,
  requireSafetyCommentForTypeAssertion,
  noUnsafeDictionaryType,
} from "../../tooling/eslint-plugin-type-evidence/index.js";

// Unit tests for the type-evidence ESLint rules. These rules run over every
// package and example on every lint pass. A false positive blocks an
// unrelated pull request. A false negative lets discarded type evidence
// back in silently.

const linter = new Linter();

function lint(rule: string, ruleImpl: Rule.RuleModule, code: string): string[] {
  const messages = linter.verify(code, {
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "type-evidence": { rules: { [rule]: ruleImpl } },
    },
    rules: {
      [`type-evidence/${rule}`]: "error",
    },
  });
  return messages.map((message) => message.messageId ?? message.message);
}

let failureCount = 0;

function expectClean(rule: string, ruleImpl: Rule.RuleModule, code: string, label: string): void {
  const messageIds = lint(rule, ruleImpl, code);
  if (messageIds.length === 0) {
    console.log(`ok - ${label}`);
  } else {
    failureCount += 1;
    console.error(`not ok - ${label}: expected no report, received ${messageIds.join(", ")}`);
  }
}

function expectReport(
  rule: string,
  ruleImpl: Rule.RuleModule,
  code: string,
  expectedMessageId: string,
  label: string,
): void {
  const messageIds = lint(rule, ruleImpl, code);
  if (messageIds.includes(expectedMessageId)) {
    console.log(`ok - ${label}`);
  } else {
    failureCount += 1;
    console.error(
      `not ok - ${label}: expected "${expectedMessageId}", received: ${messageIds.join(", ") || "(none)"}`,
    );
  }
}

// no-chained-type-assertions

expectClean(
  "no-chained-type-assertions",
  noChainedTypeAssertions,
  "const value = input as string;",
  "a single assertion is allowed",
);

expectClean(
  "no-chained-type-assertions",
  noChainedTypeAssertions,
  "const value = input as const;",
  "a const assertion chained with a cast is not itself a chain trigger",
);

expectReport(
  "no-chained-type-assertions",
  noChainedTypeAssertions,
  "const value = input as unknown as string;",
  "chained",
  "an unknown-widening double assertion is rejected",
);

expectReport(
  "no-chained-type-assertions",
  noChainedTypeAssertions,
  "const value = (input as unknown) as string;",
  "chained",
  "a parenthesized double assertion is rejected",
);

expectClean(
  "no-chained-type-assertions",
  noChainedTypeAssertions,
  "const value = input as const satisfies string;",
  "a lone const assertion nested under another expression is allowed",
);

// require-safety-comment-for-type-assertion

expectReport(
  "require-safety-comment-for-type-assertion",
  requireSafetyCommentForTypeAssertion,
  "const value = input as string;",
  "missingTypeEvidenceComment",
  "an assertion with no comment is rejected",
);

expectClean(
  "require-safety-comment-for-type-assertion",
  requireSafetyCommentForTypeAssertion,
  "// TYPE-EVIDENCE: input was validated above.\nconst value = input as string;",
  "an assertion preceded by a TYPE-EVIDENCE comment on its statement is allowed",
);

expectClean(
  "require-safety-comment-for-type-assertion",
  requireSafetyCommentForTypeAssertion,
  "const value = input as const;",
  "a const assertion never requires a TYPE-EVIDENCE comment",
);

expectReport(
  "require-safety-comment-for-type-assertion",
  requireSafetyCommentForTypeAssertion,
  "// just a note\nconst value = input as string;",
  "missingTypeEvidenceComment",
  "a comment without the TYPE-EVIDENCE marker does not satisfy the rule",
);

expectClean(
  "require-safety-comment-for-type-assertion",
  requireSafetyCommentForTypeAssertion,
  "function read() {\n  // TYPE-EVIDENCE: the caller guarantees a string here.\n  return input as string;\n}",
  "a TYPE-EVIDENCE comment covering the containing return statement is allowed",
);

// no-unsafe-dictionary-type

expectReport(
  "no-unsafe-dictionary-type",
  noUnsafeDictionaryType,
  "type Loose = Record<string, any>;",
  "unsafeDictionary",
  "a Record with an any value is rejected",
);

expectReport(
  "no-unsafe-dictionary-type",
  noUnsafeDictionaryType,
  "type Loose = { [key: string]: object };",
  "unsafeDictionary",
  "an index signature with an object value is rejected",
);

expectReport(
  "no-unsafe-dictionary-type",
  noUnsafeDictionaryType,
  "type Loose = { [key: string]: {} };",
  "unsafeDictionary",
  "an index signature with an empty-object value is rejected",
);

expectClean(
  "no-unsafe-dictionary-type",
  noUnsafeDictionaryType,
  "type Typed = Record<string, number>;",
  "a Record with a concrete value type is allowed",
);

expectClean(
  "no-unsafe-dictionary-type",
  noUnsafeDictionaryType,
  "type Typed = { [key: string]: string[] };",
  "an index signature with a concrete value type is allowed",
);

expectReport(
  "no-unsafe-dictionary-type",
  noUnsafeDictionaryType,
  "type Alias = any;\ntype Loose = Record<string, Alias>;",
  "unsafeDictionary",
  "a value type that resolves through a type alias to any is rejected",
);

if (failureCount > 0) {
  console.error(`\n${failureCount} type-evidence lint rule test failure(s).`);
  process.exitCode = 1;
} else {
  console.log("type-evidence lint rule tests passed.");
}
