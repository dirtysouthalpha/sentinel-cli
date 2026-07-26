// Flat config (ESLint 9). Two logical groups: the main Node/TS package in
// src+tests, and the browser GUI under gui/src which targets a different lib.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "gui/node_modules/**",
      "gui/dist/**",
      "scripts/**",
      "coverage/**",
      "**/*.cjs",
    ],
  },

  // --- Main package: src + tests ---
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { node: true },
    },
    rules: {
      // The codebase deliberately uses `as` for runtime-driven casts (provider
      // payloads, tool args). Warn rather than error to keep lint useful but
      // not obstructive while we tighten types over time.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      // Non-null assertions are used in tight TUI/blessed code; flag later.
      "no-unused-private-class-members": "warn",
      "prefer-const": "warn",
      "no-constant-condition": "off",
      eqeqeq: ["warn", "smart"],
      "no-inner-declarations": "off",
    },
  },

  // --- GUI: browser TS, different globals ---
  {
    files: ["gui/src/**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { window: true, document: true, navigator: true, console: true },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  }
);
