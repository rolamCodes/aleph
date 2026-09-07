import convex from "@convex-dev/eslint-plugin";
import typescriptParser from "@typescript-eslint/parser";

export default [
  { ignores: ["convex/_generated/**"] },
  {
    files: ["convex/**/*.ts"],
    languageOptions: { parser: typescriptParser },
  },
  ...convex.configs.recommended,
];
