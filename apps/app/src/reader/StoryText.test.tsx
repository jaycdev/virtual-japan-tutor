import type { StoryGrammarSpan, StoryToken } from "@vjt/api-client";
import { describe, expect, it } from "vitest";

import type { ThemeColors } from "../theme.ts";
import { tokenDecoration } from "./StoryText.tsx";

/**
 * The token underline mapping (issue #14 review, fix 5). RN docs mark
 * textDecorationStyle and textDecorationColor as iOS-only (verified against
 * reactnative.dev/docs/next/text-style-props with RN 0.88.1 in node_modules),
 * so on Android every one of them collapses to the same solid line in the
 * text's colour. The mobile mapping therefore distinguishes the four web
 * classes with cross-platform props only — textDecorationLine + text colour
 * (+ weight for Focus Grammar) — and must never emit the iOS-only keys.
 */

const colors = { label: "#1b1b1f", subtle: "#5f6368", accent: "#3949ab" } as ThemeColors;

const tok = (over: Partial<StoryToken>): StoryToken =>
  ({ surface: "x", start: 0, end: 1, reading: "x", tag: "unknown", showFurigana: false, ...over }) as StoryToken;

const span = (over: Partial<StoryGrammarSpan>): StoryGrammarSpan =>
  ({ start: 0, end: 1, grammarPointId: "1", isFocus: false, pattern: "～てしまう", meaning: "…", ...over }) as StoryGrammarSpan;

describe("tokenDecoration (Android-real underline mapping)", () => {
  it("Known Items get an underline in the body colour", () => {
    expect(tokenDecoration(tok({ tag: "known" }), [], colors)).toEqual({
      textDecorationLine: "underline",
      color: colors.label,
    });
  });

  it("unknown words with a dictionary entry get an underline in the dim colour", () => {
    expect(tokenDecoration(tok({ entSeq: 1, tag: "unknown" }), [], colors)).toEqual({
      textDecorationLine: "underline",
      color: colors.subtle,
    });
  });

  it("unlinked words get no underline", () => {
    expect(tokenDecoration(tok({ tag: "unknown" }), [], colors)).toEqual({ textDecorationLine: "none" });
  });

  it("Grammar Spans get a purple underline, the Focus Grammar one darker and bolder", () => {
    expect(tokenDecoration(tok({ tag: "unknown" }), [span({})], colors)).toEqual({
      textDecorationLine: "underline",
      color: "#7c3aed",
    });
    expect(tokenDecoration(tok({ tag: "unknown" }), [span({ isFocus: true })], colors)).toEqual({
      textDecorationLine: "underline",
      color: "#5b21b6",
      fontWeight: "600",
    });
  });

  it("never emits iOS-only props, and all four classes end up distinct", () => {
    const styles = [
      tokenDecoration(tok({ tag: "known" }), [], colors),
      tokenDecoration(tok({ entSeq: 1, tag: "unknown" }), [], colors),
      tokenDecoration(tok({ tag: "unknown" }), [], colors),
      tokenDecoration(tok({ tag: "unknown" }), [span({})], colors),
      tokenDecoration(tok({ tag: "unknown" }), [span({ isFocus: true })], colors),
    ];
    for (const s of styles) {
      expect(s).not.toHaveProperty("textDecorationStyle");
      expect(s).not.toHaveProperty("textDecorationColor");
    }
    const distinct = new Set(styles.map((s) => JSON.stringify(s)));
    expect(distinct.size).toBe(5);
  });
});
