import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { renderNativeCss, renderWebCss } from "./render.ts";
import { palette, type ColorToken, type Palette, type Theme } from "./tokens.ts";

// Every colour role in plan 2.2 (standard table, then reader and app table).
const PLAN_COLOURS: ColorToken[] = [
  "background", "foreground", "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground", "muted",
  "muted-foreground", "accent", "accent-foreground", "destructive", "destructive-foreground",
  "border", "input", "ring",
  "focus", "grammar", "grammar-focus", "lookup-mark", "furigana", "pitch", "success",
  "selected-sentence", "backdrop",
];

const THEMES: Theme[] = ["light", "dark"];

// WCAG 2.x relative luminance and contrast ratio. Backdrop is rgba and never
// used as a text or mark colour, so these helpers take opaque hex only.
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: [ColorToken, ColorToken][] = [
  ["foreground", "background"],
  ["card-foreground", "card"],
  ["popover-foreground", "popover"],
  ["primary-foreground", "primary"],
  ["secondary-foreground", "secondary"],
  ["muted-foreground", "background"],
  ["muted-foreground", "muted"],
  ["accent-foreground", "accent"],
  ["destructive-foreground", "destructive"],
  ["primary", "background"],
  ["destructive", "background"],
  ["success", "background"],
  ["furigana", "background"],
  ["foreground", "grammar"],
  ["foreground", "grammar-focus"],
  ["foreground", "selected-sentence"],
];

// Marks and outlines against the page: lookup underline, Focus Set vermilion,
// focus ring. Pairs that fail today are listed separately below.
const MARK_PAIRS: [ColorToken, ColorToken][] = [
  ["lookup-mark", "background"],
  ["focus", "background"],
  ["ring", "background"],
];

// Known failures (WCAG 1.4.11, 3:1 for UI boundaries). The current border and
// input values are below 3:1 on background in both themes. The palette is not
// changed here; #58 tracks the fix, and it.fails flags the day it passes.
const KNOWN_FAILING_PAIRS: [ColorToken, ColorToken][] = [
  ["border", "background"],
  ["input", "background"],
];

describe("palette", () => {
  it("names every plan 2.2 colour", () => {
    expect(PLAN_COLOURS).toHaveLength(28);
  });

  for (const theme of THEMES) {
    it(`has every plan 2.2 colour in the ${theme} theme, as hex or rgba`, () => {
      const p: Palette = palette[theme];
      for (const key of PLAN_COLOURS) {
        expect(p[key], `${theme}.${key}`).toMatch(/^(#[0-9a-f]{6}|rgba\(.+\))$/i);
      }
      expect(Object.keys(p).sort()).toEqual([...PLAN_COLOURS].sort());
    });
  }
});

describe("generated CSS is current", () => {
  // The committed files must match what the tokens render to. CI also runs
  // check:generated, but this fails in a plain `pnpm test` too.
  it("web.css matches tokens.ts", () => {
    expect(readFileSync(new URL("../web.css", import.meta.url), "utf8")).toBe(renderWebCss());
  });

  it("native.css matches tokens.ts", () => {
    expect(readFileSync(new URL("../native.css", import.meta.url), "utf8")).toBe(renderNativeCss());
  });
});

describe("contrast", () => {
  for (const theme of THEMES) {
    describe(`${theme} theme`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        it(`text ${fg} on ${bg} is at least 4.5:1`, () => {
          const p = palette[theme];
          expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
        });
      }

      for (const [part, bg] of MARK_PAIRS) {
        it(`mark ${part} on ${bg} is at least 3:1`, () => {
          const p = palette[theme];
          expect(contrast(p[part], p[bg])).toBeGreaterThanOrEqual(3);
        });
      }

      for (const [part, bg] of KNOWN_FAILING_PAIRS) {
        // Known failure, see #58: this passes only while the palette is below 3:1.
        it.fails(`known failure #58: ${part} on ${bg} is at least 3:1`, () => {
          const p = palette[theme];
          expect(contrast(p[part], p[bg])).toBeGreaterThanOrEqual(3);
        });
      }
    });
  }
});
