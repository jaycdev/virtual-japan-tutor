import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// #43 design rule: apps/app/global.css is the single source of colours
// (palette, type, fonts). Hex colour literals in app code silently break
// light/dark parity, so this inline rule fails them at review time. CSS
// colours never reach JS here: components style via Uniwind classNames that
// reference the custom properties, and components that take colour VALUES
// (icons, switches) resolve the tokens at runtime with useCSSVariable. The
// pre-#43 allowlist for the legacy JS palette (theme.ts / ui.tsx) went away
// with #51: nothing in apps/app styles from hex literals any more.
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

// #45 design rule, same reasoning as the colour gate: the type steps are part
// of the single source too (the --text-* tokens). A numeric fontSize in a
// reader component is a size no token sweep can follow, so it fails at review
// time. Sizes that come from the Learner's saved Story text size
// (`fontSizePx`) are not literals and pass.
const noInlineFontSize = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      noFontSize:
        "Inline font size. Type steps live in apps/app/global.css (design tokens); use a text-* class, or the saved Story text size from useStoryTextSize.",
    },
  },
  create(context) {
    return {
      Property(node) {
        const key = node.key;
        if ((key.type !== "Identifier" && key.type !== "Literal") || String(key.name ?? key.value) !== "fontSize") return;
        const value = node.value;
        if (value.type === "Literal" && typeof value.value === "number") context.report({ node, messageId: "noFontSize" });
        else if (value.type === "ConditionalExpression") {
          for (const branch of [value.consequent, value.alternate]) {
            if (branch.type === "Literal" && typeof branch.value === "number") context.report({ node, messageId: "noFontSize" });
          }
        }
      },
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
    plugins: {
      "react-hooks": reactHooks,
      vjt: { rules: { "no-hardcoded-color": noHardcodedColor, "no-inline-font-size": noInlineFontSize } },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // The colour gate scopes to the Expo app: since #51 apps/app is the only
    // client, and every surface in it styles through the design tokens.
    files: ["apps/app/**/*.{ts,tsx}"],
    rules: { "vjt/no-hardcoded-color": "error" },
  },
  {
    // The font-size gate (#43, widened on #48 review): every screen in apps/app
    // sets type through the token scale - text-caption / -small / -body /
    // -title-sm - or through the Learner's saved Story text size, never through
    // a number in a style object.
    files: ["apps/app/src/**/*.tsx"],
    rules: { "vjt/no-inline-font-size": "error" },
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
  {
    // Benign CommonJS shims that vitest aliases over native-only modules
    // (see apps/app/vitest.setup.ts): hand-written CJS, not app code.
    files: ["apps/app/test/cjs-stubs/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, window: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
