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
    // The colour gate scopes to the Expo app: apps/app is the surface being
    // redesigned (#43); apps/web is the legacy client, porting is not planned.
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
    // Legacy JS-styled surface (see the note above): gate stays green today,
    // shrinks as #45..#50 port screens onto the Uniwind tokens. ui.tsx is the
    // shared surface those legacy screens use; it comes off with the last one
    // in #51. The Story reader (#45) and the rebuilt Stories page (#48) style
    // through the design tokens and are not listed.
    files: ["apps/app/src/theme.ts", "apps/app/src/ui.tsx"],
    rules: { "vjt/no-hardcoded-color": "off", "vjt/no-inline-font-size": "off" },
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
