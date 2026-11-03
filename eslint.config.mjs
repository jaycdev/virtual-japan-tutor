import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// #43 design rule: apps/app/global.css is the single source of colours
// (palette, type, fonts). Hex colour literals in app code silently break
// light/dark parity, so this inline rule fails them at review time. CSS
// colours never reach JS here: components style via Uniwind classNames that
// reference the custom properties. The legacy allowlist block below is the
// pre-#43 surface that still styles from JS (theme.ts and the screens built
// in issues #34-#41); each ported screen drops off it, and #51 deletes the
// block once the last one is gone.
const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z])/;

const noHardcodedColor = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      noColor:
        "Hardcoded colour literal. Colours live in apps/app/global.css (design tokens); use Uniwind classNames or var(--color-*) instead.",
    },
  },
  create(context) {
    const check = (node, value) => {
      if (HEX_COLOR.test(value)) context.report({ node, messageId: "noColor" });
    };
    return {
      Literal: (node) => {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement: (node) => check(node, node.raw),
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "apps/app/dist-web*/**",
      "**/node_modules/**",
      "**/.expo/**",
      "**/.turbo/**",
      "**/src/generated/**",
      "apps/server/**",
      "**/assets/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { "react-hooks": reactHooks, vjt: { rules: { "no-hardcoded-color": noHardcodedColor } } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "vjt/no-hardcoded-color": "error",
    },
  },
  {
    // Legacy JS-styled surface (see the note above): gate stays green today,
    // shrinks as #45..#50 port screens onto the Uniwind tokens. Listed here:
    // the token bridge itself, and the reader surface built in #42 which
    // still styles inline with hex colours until #46 ports it.
    files: [
      "apps/app/src/theme.ts",
      "apps/app/src/reader/**",
      "apps/app/src/Stories.test.tsx",
    ],
    rules: { "vjt/no-hardcoded-color": "off" },
  },
  {
    // `_`-prefixed arguments/variables document a signature while staying
    // unused (test stubs); ignore them by convention rather than per-file.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Metro and friends only load CommonJS config files
    files: ["**/*.config.js"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
