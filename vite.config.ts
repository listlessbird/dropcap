import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

// Agent tooling and vendored plugins are not application source.
const AGENT_DIRS = [
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".cursor/**",
  ".opencode/**",
];

const GENERATED = [
  ...AGENT_DIRS,
  "oxlint-plugin-anti-slop/**",
  ".repos/**",
  "node_modules",
  "pnpm-lock.yaml",
  "*.tsbuildinfo",
  "apps/mobile/android/**",
  "apps/mobile/ios/**",
  "apps/mobile/uniwind-types.d.ts",
  // `ubrn generate` output, committed so CI and JS-only work need no Rust toolchain.
  "apps/mobile/modules/kindle-core/src/**",
  "apps/mobile/modules/kindle-core/rust/target/**",
  "apps/mobile/modules/kindle-core/android/build/**",
];

// `vp test run` from the root runs every package's tests as projects. The lint plugin borrows this
// config from its own directory (`--config ../vite.config.ts`), where it stays one plain project.
const isRepoRootTestRun = process.cwd() === import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/.repos/**", "**/.t3/**", "**/node_modules/**", "**/dist/**"],
    allowOnly: !process.env.CI,
    retry: 0,
    // A loaded machine (parallel agents, native builds) can stall a test for seconds. Flaky tests are
    // still fixed, never retried.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    projects: isRepoRootTestRun
      ? [
          "apps/mobile",
          {
            extends: true,
            test: {
              name: "worker",
              include: ["apps/worker/**/*.test.ts"],
              // Throwaway tokens for the local stack the tests boot. Prod reads its own.
              env: { APP_TOKEN: "test-app-token", KINDLE_TOKEN: "test-kindle-token" },
            },
          },
          {
            extends: true,
            test: { name: "lint-rules", include: ["oxlint-plugin-kd/**/*.test.ts"] },
          },
          // Runs the Kindle scripts under busybox sh with the sqlite3 CLI, as the device does.
          { extends: true, test: { name: "kindle", include: ["kindle/**/*.test.ts"] } },
        ]
      : undefined,
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: GENERATED,
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: [".repos", ...GENERATED],
    plugins: ["eslint", "oxc", "react", "unicorn", "typescript"],
    jsPlugins: [
      "./oxlint-plugin-kd/index.ts",
      { name: "anti-slop", specifier: "./oxlint-plugin-anti-slop/index.ts" },
      { name: "anti-slop-effect", specifier: "./oxlint-plugin-anti-slop/effect/index.ts" },
    ],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "oxc/no-accumulating-spread": "error",
      "eslint/no-control-regex": "off",
      "typescript/no-this-alias": "off",
      "unicorn/prefer-add-event-listener": "off",
      "unicorn/prefer-string-starts-ends-with": "off",
      "unicorn/prefer-set-has": "off",
      "unicorn/prefer-array-find": "off",
      "unicorn/no-new-array": "off",
      "unicorn/no-array-reverse": "off",
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "react/no-object-type-as-default-prop": "off",
      // The React Compiler memoizes context values; this rule would ask for useMemo.
      "react/jsx-no-constructed-context-values": "off",
      "react/memo-dependencies": "error",
      "react/purity": "error",
      "react/refs": "error",
      "react/exhaustive-effect-dependencies": "error",
      "react/set-state-in-effect": "error",
      "react/set-state-in-render": "error",
      "react/immutability": "error",
      "react/globals": "error",
      "react/hooks": "error",
      "react/no-array-index-key": "error",
      "react/no-unstable-nested-components": "error",
      "react/static-components": "error",
      "react/capitalized-calls": "error",
      "react/preserve-manual-memoization": "error",
      "react/unsupported-syntax": "error",
      "react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "typescript/no-extraneous-class": "error",
      "eslint/no-empty-pattern": "error",
      "eslint/no-new": "error",
      "unicorn/no-useless-spread": "error",
      "eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "eslint/no-unsafe-optional-chaining": "error",
      "eslint/no-unneeded-ternary": "error",
      "unicorn/no-useless-fallback-in-spread": "error",
      "unicorn/require-module-specifiers": "error",
      "oxc/no-map-spread": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "anti-slop/no-array-filter-map": "error",
      "anti-slop/no-reduce-accumulator-copy": "error",
      "anti-slop/no-chained-type-assertions": "error",
      "anti-slop/no-conditional-empty-object-spread": "error",
      "anti-slop/no-known-value-widening": "error",
      "anti-slop/no-module-mocking": "error",
      "anti-slop/no-object-parameters": "error",
      "anti-slop/no-reflect-apply": "error",
      "anti-slop/no-reflect-get": "error",
      "anti-slop/no-runtime-typeof": "error",
      "anti-slop/no-shape-in-symbol-names": "error",
      "anti-slop/no-unknown-parameters": "error",
      "anti-slop/no-unknown-returns": "error",
      "anti-slop/no-unknown-type-aliases": "error",
      "anti-slop/no-unsafe-dictionary-type": "error",
      "anti-slop/no-widen-then-assert": "error",
      "anti-slop/require-readable-spacing": "error",
      "anti-slop/require-safety-comment-for-type-assertion": "error",
      "anti-slop-effect/no-manual-effect-error-tag": "error",
      "anti-slop-effect/no-manual-tag-comparison": "error",
      "anti-slop-effect/no-manual-tagged-construction": "error",
      "anti-slop-effect/no-service-constructor-imports": "error",
      "anti-slop-effect/prefer-effect-match": "error",
      "kd/namespace-node-imports": "error",
      "kd/no-inline-schema-compile": "error",
      "kd/no-low-value-comments": "error",
      "kd/no-manual-effect-runtime-in-tests": "error",
      "kd/prefer-catch-tags": "error",
      "kd/prefer-effect-fn": "error",
      "kd/require-suppression-reason": "error",
      // These check the filename and only fire in test files.
      "kd/no-polling-loop-in-tests": "error",
      "kd/no-real-time-wait-in-tests": "error",
      "kd/no-test-in-loop": "error",
      "kd/no-test-timeout-or-unreasoned-skip": "error",
      "kd/no-wall-clock-in-tests": "error",
    },
    overrides: [
      {
        // Lint rules parse raw ESTree nodes, so unknown inputs and typeof narrowing are their boundary.
        files: ["oxlint-plugin-kd/**"],
        rules: {
          "anti-slop/no-unknown-parameters": "off",
          "anti-slop/no-runtime-typeof": "off",
          "anti-slop/require-safety-comment-for-type-assertion": "off",
        },
      },
      {
        files: ["**/*.{test,spec}.{ts,tsx}", "**/{test,tests,testing,fixtures}/**"],
        rules: { "kd/prefer-effect-fn": "off" },
      },
      {
        files: ["apps/mobile/src/**/*.{ts,tsx}"],
        rules: {
          "kd/no-hookless-use-function": "error",
          "kd/no-manual-memo": "error",
          "kd/no-mobile-uniwind-theme-escape-hatches": "error",
          "kd/react-effect-budget": "error",
        },
      },
      {
        // ESNext types allow APIs that Hermes lacks. Node-run tests are exempt.
        files: ["apps/mobile/src/**"],
        excludeFiles: ["**/*.test.ts", "**/*.test.tsx"],
        rules: {
          "kd/no-hermes-unsupported-apis": "error",
          "kd/no-em-dash-copy": "error",
        },
      },
    ],
  },
});
