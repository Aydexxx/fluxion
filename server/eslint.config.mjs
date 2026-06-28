import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Prisma's generated client is checked-in build output, not source we maintain.
const ignores = ["**/generated/**"];

export default [
  {
    files: ["**/*.ts"],
    ignores,
    languageOptions: { globals: globals.node },
    rules: js.configs.recommended.rules,
  },
  // Each entry gets its own `files`/`ignores` (rather than a single shared
  // global-ignores config) because this eslint/typescript-eslint combo stops
  // honoring global ignores once any config object registers `plugins`.
  ...tseslint.configs.recommended.map((c) => ({ ...c, files: c.files ?? ["**/*.ts"], ignores })),
  {
    files: ["**/*.ts"],
    ignores,
    rules: {
      // Express error handlers must keep all 4 params even when unused
      // (the arity is how Express recognizes error-handling middleware).
      // `ignoreRestSiblings` allows the `const { omit, ...rest } = obj` idiom we
      // use to strip a property (e.g. pinnedData) from an object copy.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
];
