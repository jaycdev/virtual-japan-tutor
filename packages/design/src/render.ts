// Pure renderers: tokens.ts in, CSS text out. scripts/generate.ts writes the
// results to web.css and native.css, and tokens.test.ts re-renders them to
// catch stale committed files.
import { fonts, palette, radius, storyText, typeScale, type ColorToken, type Theme } from "./tokens.ts";

const HEADER =
  "/* GENERATED from packages/design/src/tokens.ts by scripts/generate.ts. Do not edit;\n" +
  "   run `pnpm generate` and commit the result. */\n";

const colorKeys = Object.keys(palette.light) as ColorToken[];

const px = (n: number): string => `${n}px`;

/** Interface type scale and Story text sizes, shared by both outputs. */
function typeLines(indent: string): string[] {
  const lines: string[] = [];
  for (const [name, { size, lineHeight }] of Object.entries(typeScale)) {
    lines.push(`${indent}--text-${name}: ${px(size)};`);
    lines.push(`${indent}--text-${name}--line-height: ${px(lineHeight)};`);
  }
  // Unitless multiples of the Story text size. toFixed keeps the tokens
  // spelled as in the design plan (2.0, 2.1, 2.2).
  for (const [key, { size, lineHeight }] of Object.entries(storyText)) {
    const name = key.toLowerCase();
    lines.push(`${indent}--text-story-${name}: ${px(size)};`);
    lines.push(`${indent}--text-story-${name}--line-height: ${lineHeight.toFixed(1)};`);
  }
  for (const [key, { furigana }] of Object.entries(storyText)) {
    lines.push(`${indent}--text-furigana-${key.toLowerCase()}: ${px(furigana)};`);
  }
  return lines;
}

/**
 * web.css: Tailwind 4 for the web app. The app imports tailwindcss itself, so
 * this file only defines variables, the dark variant and the theme mapping.
 * Colours are raw variables (--background) that `@theme inline` maps to the
 * utilities' --color-* names, which is the shadcn/ui convention.
 */
export function renderWebCss(): string {
  // Web-only fallbacks: the bundled faces come first, then the platform stack.
  // Native uses the bare names (the TS tokens and native.css), so this is a
  // deliberate web difference, not a second source of truth.
  const webFamilies = {
    sans: `"${fonts.sans}", ui-sans-serif, system-ui, sans-serif`,
    "sans-bold": `"${fonts.sansBold}", ui-sans-serif, system-ui, sans-serif`,
    serif: `"${fonts.serif}", ui-serif, Georgia, serif`,
    "serif-bold": `"${fonts.serifBold}", ui-serif, Georgia, serif`,
  };
  const rootVars = colorKeys.map((k) => `  --${k}: ${palette.light[k]};`);
  const darkVars = colorKeys.map((k) => `  --${k}: ${palette.dark[k]};`);
  const inline = colorKeys.map((k) => `  --color-${k}: var(--${k});`);
  const fontLines = Object.entries(webFamilies).map(([k, v]) => `  --font-${k}: ${v};`);
  const radiusLines = [
    `  --radius-lg: var(--radius);`,
    `  --radius-md: ${px(radius.md)};`,
    `  --radius-sm: calc(var(--radius) - 4px);`,
  ];
  return [
    HEADER,
    `:root {`,
    // Native form controls and scrollbars follow the theme.
    `  color-scheme: light;`,
    `  --radius: ${px(radius.base)};`,
    ...rootVars,
    `}`,
    ``,
    `.dark {`,
    `  color-scheme: dark;`,
    ...darkVars,
    `}`,
    ``,
    `@custom-variant dark (&:where(.dark, .dark *));`,
    ``,
    `@theme inline {`,
    ...inline,
    `}`,
    ``,
    `@theme {`,
    ...radiusLines,
    ...fontLines,
    ...typeLines("  "),
    `}`,
    ``,
  ].join("\n");
}

function themeBlock(theme: Theme, indent: string): string[] {
  return [
    `${indent}@variant ${theme} {`,
    ...colorKeys.map((k) => `${indent}  --color-${k}: ${palette[theme][k]};`),
    `${indent}}`,
  ];
}

/**
 * native.css: Uniwind for the mobile app, the same shape as the theme that
 * apps/mobile/global.css carried before this package existed. The app imports it
 * after tailwindcss and uniwind.
 */
export function renderNativeCss(): string {
  return [
    HEADER,
    `@theme {`,
    `  --radius: ${px(radius.base)};`,
    `  --radius-lg: var(--radius);`,
    `  --radius-md: ${px(radius.md)};`,
    `  --radius-sm: calc(var(--radius) - 4px);`,
    ``,
    `  --font-sans: "${fonts.sans}";`,
    `  --font-sans-bold: "${fonts.sansBold}";`,
    `  --font-serif: "${fonts.serif}";`,
    `  --font-serif-bold: "${fonts.serifBold}";`,
    ``,
    ...typeLines("  "),
    `}`,
    ``,
    `@layer theme {`,
    `  :root {`,
    ...themeBlock("light", "    "),
    ...themeBlock("dark", "    "),
    `  }`,
    `}`,
    ``,
  ].join("\n");
}
