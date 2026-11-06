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

// #125 interface-language rule: raw string literals in JSX can never follow the
// Learner's Interface Language setting, so apps/web renders interface copy from
// the @vjt/core table via <T k="…"/> / <TableText>. The rule flags copy in JSXText
// children, in bare string-expression children, and in string-valued attributes
// that carry visible or announced text (aria-label, placeholder, title, label,
// hint, error, message, legend, alt, description — the props our own components
// read as copy), and it recurses through ConditionalExpression, LogicalExpression
// and TemplateLiteral children so a ternary cannot hide copy inside an otherwise
// table-backed element. Exempt: text with no letters — punctuation separators and
// digit-only counts (<span>3</span>) are not copy — and learning content, which
// arrives as props or interpolated values (meanings, example sentences, exercise
// options), never as JSX text. tp()/translatePlain() calls pass: they are the
// escape hatch for the handful of slots that only accept a string (aria-label,
// placeholder, document.title). The few deliberate exceptions (the 読 logotype,
// the 吾輩は猫である sample line) carry targeted eslint-disable comments with a
// reason. apps/mobile is covered by the same rule (#125 PR 3), with the React
// Native text attributes added to TEXT_ATTRIBUTES below.
const LETTER = /\p{L}/u;
function isCopy(value) {
  return LETTER.test(value);
}

const TEXT_ATTRIBUTES = new Set([
  "aria-label",
  "aria-valuetext",
  "aria-description",
  "aria-placeholder",
  "placeholder",
  "title",
  "label",
  "hint",
  "error",
  "message",
  "legend",
  "alt",
  "description",
  // React Native props that carry copy on mobile (#125 PR 3): announced by
  // TalkBack (accessibilityLabel/Hint/Value) or read by our own components
  // (label on form fields). accessibilityRole is an enum, not copy.
  "accessibilityLabel",
  "accessibilityHint",
  "accessibilityValue",
]);

// Walk one expression for raw copy. Only leaf kinds are checked; calls (tp(…),
// a Learner-typed value, a data prop) are not walked — their text is not in the
// JSX. A template is copy when any literal chunk is: `Page ${n}` yes, `${a} · ${b}` no.
function walkCopy(node, report) {
  switch (node.type) {
    case "Literal":
      if (typeof node.value === "string" && isCopy(node.value.trim())) report(node);
      break;
    case "TemplateLiteral":
      if (node.quasis.some((q) => isCopy(q.value.cooked ?? q.value.raw))) report(node);
      break;
    case "ConditionalExpression":
      walkCopy(node.consequent, report);
      walkCopy(node.alternate, report);
      break;
    case "LogicalExpression":
      walkCopy(node.left, report);
      walkCopy(node.right, report);
      break;
  }
}

// Walk the node's raw text up to its first non-whitespace character.
function firstVisibleLoc(node) {
  let line = node.loc.start.line;
  let column = node.loc.start.column;
  for (const ch of node.value) {
    if (!/\s/u.test(ch)) break;
    if (ch === "\n") {
      line += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { line, column };
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
    const flag = (node) => context.report({ node, messageId: "noRawText" });
    return {
      JSXText(node) {
        const value = node.value.trim();
        // JSXText starts right after the previous element/expression, on ITS line —
        // report at the first visible character instead, so an eslint-disable-next-line
        // above the copy covers it (and editors point at the copy, not the tag).
        const at = firstVisibleLoc(node);
        if (value && isCopy(value)) context.report({ node, loc: at, messageId: "noRawText" });
      },
      JSXExpressionContainer(node) {
        // Children are always under inspection; an attribute's container only when
        // the attribute carries text. Every other attribute expression
        // — className, onClick, data — is not copy.
        const parent = node.parent;
        if (parent && parent.type === "JSXAttribute") {
          const name = parent.name.type === "JSXIdentifier" ? parent.name.name : "";
          if (!TEXT_ATTRIBUTES.has(name)) return;
        } else if (!parent || (parent.type !== "JSXElement" && parent.type !== "JSXFragment")) {
          return;
        }
        // Bare string literals in children are the sneaky twin of <span>Text</span>;
        // the walk covers ternaries, && chains and templates too.
        walkCopy(node.expression, flag);
      },
      JSXAttribute(node) {
        // aria-label="Close": the plain literal form, which is not an expression container.
        if (!node.value || node.value.type !== "Literal") return;
        const name = node.name.type === "JSXIdentifier" ? node.name.name : "";
        if (!TEXT_ATTRIBUTES.has(name)) return;
        const value = String(node.value.value ?? "").trim();
        if (value && isCopy(value)) context.report({ node: node.value, messageId: "noRawText" });
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
    // The interface-language gate (#125): apps/web and apps/mobile, source
    // files only - tests may quote raw copy. Mobile copy also comes from the
    // @vjt/core table via <T> / <TableText>; tp() covers the string-only slots
    // (accessibilityLabel, placeholder, Alert titles, header/tab titles).
    files: ["apps/web/src/**/*.tsx", "apps/mobile/**/*.tsx"],
    ignores: ["apps/web/src/**/*.test.tsx", "apps/mobile/**/*.test.tsx"],
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
