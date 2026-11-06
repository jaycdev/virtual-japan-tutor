import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

// #43 design rule: packages/design is the single source of colours (palette,
// type, fonts; ADR-0010). Hex colour literals in app code silently break
// light/dark parity, so this inline rule fails them at review time. CSS
// colours never reach JS here: components style via classNames that reference
// the custom properties (Uniwind on mobile, Tailwind on web), and components
// that take colour VALUES (icons, switches) resolve the tokens at runtime with
// useCSSVariable. packages/design is the only exception, since it holds the
// hex values that generate web.css and native.css.
const HEX_COLOR = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z])/;
// Functional notations too: a DOM className or style value can carry rgb(...)
// just as easily as #hex. (Nothing outside packages/design uses them today.)
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?|oklch|oklab)\(/i;

const noHardcodedColor = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      noColor:
        "Hardcoded colour literal. Colours live in packages/design (design tokens); use a token classname or var(--color-*) instead.",
    },
  },
  create(context) {
    const check = (node, value) => {
      if (HEX_COLOR.test(value) || FUNCTIONAL_COLOR.test(value)) context.report({ node, messageId: "noColor" });
    };
    return {
      Literal: (node) => {
        if (typeof node.value === "string") check(node, node.value);
      },
      // The text of a template chunk is node.value.raw (ESTree); node.raw is undefined
      // and silently disabled this handler before. Covers className={`… text-[#abc]`}.
      TemplateElement: (node) => check(node, node.value.raw),
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
        "Inline font size. Type steps live in packages/design (design tokens); use a text-* class, or the saved Story text size (fontSizePx on mobile, var(--story-text-size) on web).",
    },
  },
  create(context) {
    // A literal size: a number (React Native) or a string that starts with a digit
    // ("16px", "1.25rem", the DOM form). A var(--…) or a keyword is not a literal.
    const isLiteralSize = (node) => {
      if (node.type === "TemplateLiteral") return /^\s*\d/.test(node.quasis[0]?.value.raw ?? "");
      return node.type === "Literal" && (typeof node.value === "number" || (typeof node.value === "string" && /^\s*\d/.test(node.value)));
    };
    return {
      Property(node) {
        const key = node.key;
        if ((key.type !== "Identifier" && key.type !== "Literal") || String(key.name ?? key.value) !== "fontSize") return;
        const value = node.value;
        if (isLiteralSize(value)) context.report({ node, messageId: "noFontSize" });
        else if (value.type === "ConditionalExpression") {
          for (const branch of [value.consequent, value.alternate]) {
            if (isLiteralSize(branch)) context.report({ node, messageId: "noFontSize" });
          }
        }
      },
    };
  },
};

// #125 interface-language rule: raw string literals in JSX children can never follow
// the Learner's Interface Language setting, so apps/web renders interface text from
// the @vjt/core table via <T k="…"/> / <TableText> instead. The rule flags JSXText
// and bare string-expression children; punctuation-only text and learning content
// (meanings, example sentences, exercise options) pass. Learning content arrives as
// props, never as JSX text, so it needs no exemptions; the few deliberate exceptions
// (the 読 logotype, the 吾輩は猫である sample line) carry targeted eslint-disable
// comments with a reason. apps/mobile keeps its own conventions and is not covered.
// Punctuation and symbols (（ ） – — ' ' … · ×), not letters or digits: anything
// written in a language is copy, and copy belongs in the table.
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
function isPunctuationOnly(value) {
  return !LETTER_OR_DIGIT.test(value);
}

const noRawJsxText = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      noRawText:
        "Raw text in JSX. Interface copy comes from the @vjt/core string table so it follows the Learner's language setting; use <T k=\"…\"/> / <TableText>. Learning content (props, not JSX text) and punctuation are exempt.",
    },
  },
  create(context) {
    return {
      JSXText(node) {
        const value = node.value.trim();
        if (value && !isPunctuationOnly(value)) context.report({ node, messageId: "noRawText" });
      },
      JSXExpressionContainer(node) {
        // Bare string literals in children are the sneaky twin of <span>Text</span>.
        if (node.expression.type !== "Literal" || typeof node.expression.value !== "string") return;
        const value = node.expression.value.trim();
        if (value && !isPunctuationOnly(value)) context.report({ node: node.expression, messageId: "noRawText" });
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
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
      vjt: {
        rules: {
          "no-hardcoded-color": noHardcodedColor,
          "no-inline-font-size": noInlineFontSize,
          "no-raw-jsx-text": noRawJsxText,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // The colour gate covers every TS file in the repo (apps and packages)
    // except packages/design, which owns the hex values and generates the CSS
    // from them. A new client, such as apps/web, is covered from day one.
    files: ["**/*.{ts,tsx}"],
    ignores: ["packages/design/**"],
    rules: { "vjt/no-hardcoded-color": "error" },
  },
  {
    // The font-size gate (#43, widened on #48 review): every screen in apps/mobile
    // sets type through the token scale - text-caption / -small / -body /
    // -title-sm - or through the Learner's saved Story text size, never through
    // a number in a style object. apps/web (ADR-0010) follows the same rule on
    // the DOM: a text-* class, or var(--story-text-size), never "16px".
    files: ["apps/mobile/src/**/*.tsx", "apps/web/src/**/*.{ts,tsx}"],
    rules: { "vjt/no-inline-font-size": "error" },
  },
  {
    // The interface-language gate (#125): apps/web only, source files only -
    // tests may quote raw copy, and apps/mobile has its own conventions.
    files: ["apps/web/src/**/*.tsx"],
    ignores: ["apps/web/src/**/*.test.tsx"],
    rules: { "vjt/no-raw-jsx-text": "error" },
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
    // Build tooling for the Android APK (ADR-0012): the config plugin is CommonJS (Expo
    // loads it with require) and the build and CLI scripts run in Node.
    files: ["apps/mobile/plugins/**/*.js", "apps/mobile/scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    // Benign CommonJS shims that vitest aliases over native-only modules
    // (see apps/mobile/vitest.setup.ts): hand-written CJS, not app code.
    files: ["apps/mobile/test/cjs-stubs/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node, window: "readonly" },
    },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
