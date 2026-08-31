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
        projectService: {
          // These files sit outside every project's tsconfig `include` on
          // purpose. See tsconfig.json's `exclude` for `vite.config.ts`. The
          // create-demiurge templates are scaffolds for a generated project
          // rather than part of this one. The default project still gives
          // them type-aware linting. It just builds an isolated program
          // instead of reusing a full project reference.
          allowDefaultProject: [
            "playwright.config.ts",
            "browser-tests/*.ts",
            "examples/*/vite.config.ts",
            "packages/core/vite.config.ts",
            "packages/core/vitest.config.ts",
            "packages/create-demiurge/templates/*/vite.config.ts",
            "packages/create-demiurge/templates/*/src/vite-env.d.ts",
            "packages/create-demiurge/templates/*/src/routes/*.ts",
            "packages/create-demiurge/templates/*/src/routes/*.tsx",
            "packages/create-demiurge/templates/*/src/routes/api/*.ts",
          ],
          // These are all config/scaffold files with no full project, and the
          // repo has enough examples and templates to clear the default
          // safety threshold.
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 100,
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "type-evidence": typeEvidence,
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
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
