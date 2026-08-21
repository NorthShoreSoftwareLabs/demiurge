import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import typeEvidence from "./tooling/eslint-plugin-type-evidence/index.js";

export default tseslint.config(
  {
    ignores: [
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/.vercel/**",
      "**/.claude/**",
      "**/.omc/**",
      "examples/**/.demiurge/**",
      "tooling/eslint-plugin-type-evidence/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      "type-evidence": typeEvidence,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-object-type": [
        "error",
        {
          allowObjectTypes: "always",
          allowInterfaces: "always",
        },
      ],
      "type-evidence/no-chained-type-assertions": "error",
      "type-evidence/require-safety-comment-for-type-assertion": "error",
      "type-evidence/no-unsafe-dictionary-type": "error",
    },
  },
  {
    files: ["examples/**/public/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    // Test code casts deliberately malformed or partial values to exercise
    // runtime rejection and harness plumbing. That is not the same claim as a
    // production invariant, so this rule does not apply here. The other two
    // type-evidence rules still apply: a chained assertion or an unsafe
    // dictionary type is a bug in test code too.
    files: ["packages/core/tests/**", "browser-tests/**", "tests/**"],
    rules: {
      "type-evidence/require-safety-comment-for-type-assertion": "off",
    },
  },
);
