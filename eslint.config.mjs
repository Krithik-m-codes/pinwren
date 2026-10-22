// ESLint 9 flat config for the whole monorepo. Formatting is Prettier's job (eslint-config-prettier turns
// off every stylistic rule that would fight it), so this file is about correctness only.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const WEB = "apps/web/**/*.{js,jsx,mjs,ts,tsx,mts}";
const WWW = "apps/www/**/*.{js,jsx,mjs,ts,tsx,mts}";

export default defineConfig(
  {
    name: "pinwren/ignores",
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-*/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/next-env.d.ts",
      "apps/web/public/**",
      "apps/www/public/**",
      "apps/www/.source/**",
      "apps/www/src/generated/**",
      "packages/db/drizzle/**",
      "data/**",
    ],
  },
  {
    name: "pinwren/linter-options",
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },

  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  // Dashboard: Next's recommended set (React, hooks, a11y, @next/next, Core Web Vitals). Scoped to the app so
  // React rules never run against the widget or the API.
  ...nextVitals.map((config) => ({ ...config, files: [WEB, WWW] })),
  {
    name: "pinwren/web",
    files: [WEB, WWW],
    settings: { next: { rootDir: ["apps/web", "apps/www"] }, react: { version: "19.3" } },
    rules: {
      // The full React Compiler rule set (purity, refs, set-state-in-effect, immutability, …) — the
      // dashboard is compiled with `reactCompiler: true`, so code the compiler would bail out of is an error.
      ...reactHooks.configs["recommended-latest"].rules,
      "react-hooks/exhaustive-deps": "error",
      // eslint-config-next only enables a handful of jsx-a11y rules as warnings; use the plugin's whole
      // recommended set as errors.
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },

  // @pinwren/react: the same hook and React Compiler rules as the dashboard, so the published component is
  // safe in apps that compile with the React Compiler.
  {
    name: "pinwren/react-package",
    files: ["packages/react/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs["recommended-latest"].rules,
      "react-hooks/exhaustive-deps": "error",
    },
  },

  {
    name: "pinwren/type-aware",
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    name: "pinwren/rules",
    rules: {
      // `${count}` and `${id}` are everywhere in URLs, logs and copy; booleans and nullish values in
      // templates are still bugs.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // Event handlers and React props routinely take `() => promise`; the rule still checks conditionals
      // and spreads.
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { attributes: false } }],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // `onClick={() => setOpen(false)}` returns the setter's void; that shorthand is idiomatic React and
      // carries no confusion. Void used anywhere else (`return log()`, `x = f()`) is still flagged.
      "@typescript-eslint/no-confusing-void-expression": ["error", { ignoreArrowShorthand: true }],
      // The codebase models data with `type` aliases (unions, intersections and Zod inference all need
      // them); one style keeps declarations greppable.
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      // An empty string means "not set" throughout (form fields, env vars, headers, settings), so
      // `value || fallback` on a string is deliberate. `??` is still required for numbers and objects.
      "@typescript-eslint/prefer-nullish-coalescing": ["error", { ignorePrimitives: { string: true } }],
    },
  },

  // Plain JavaScript (build scripts, smoke tests, the cluster entry, k6) has no tsconfig: lint it without
  // type information.
  {
    name: "pinwren/javascript",
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // CommonJS by necessity: the Docker entry point requires Next's standalone server.js, which is CJS.
    name: "pinwren/commonjs",
    files: ["**/*.cjs"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    name: "pinwren/k6",
    files: ["loadtest/**/*.js"],
    languageOptions: { globals: { __ENV: "readonly", __VU: "readonly", __ITER: "readonly" } },
  },
  {
    name: "pinwren/browser-scripts",
    files: ["scripts/demo-site/**/*.js", "packages/widget/e2e/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.browser } },
  },

  prettier,
);
