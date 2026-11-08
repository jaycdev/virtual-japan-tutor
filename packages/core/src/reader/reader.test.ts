import type { PitchPattern, StoryGrammarSpan, StorySentence, StoryToken } from "@vjt/api-client";
import { describe, expect, it } from "vitest";

import { showsFurigana, furiganaPxFor } from "./furigana.ts";
import { isLookupMarked, tokenMarks } from "./marks.ts";
import { pitchDots } from "./pitch.ts";
import { sentenceSegments } from "./sentences.ts";
import { countGlosses, firstGlosses } from "./glosses.ts";

function token(overrides: Partial<StoryToken> = {}): StoryToken {
  return { surface: "学校", start: 0, end: 2, reading: "がっこう", tag: "unknown", entSeq: 990101, showFurigana: true, ...overrides };
}

function span(overrides: Partial<StoryGrammarSpan> = {}): StoryGrammarSpan {
  return {
    start: 0,
    end: 2,
    grammarPointId: "12",
    isFocus: false,
    pattern: "～てしまう",
    meaning: "completing something",
    jlptLevel: "N4",
    ...overrides,
  } as StoryGrammarSpan;
}

describe("marks", () => {
  it("a linked, unknown word gets the lookup underline; a Known Item none", () => {
    expect(isLookupMarked(token())).toBe(true);
    expect(isLookupMarked(token({ tag: "known" }))).toBe(false);
    expect(isLookupMarked(token({ entSeq: undefined }))).toBe(false);
    expect(tokenMarks(token({ tag: "known" }), []).underline).toBe("none");
  });

  it("a Focus Set word takes the focus underline instead of the lookup one", () => {
    expect(tokenMarks(token(), [], new Set([990101])).underline).toBe("focus");
    expect(tokenMarks(token(), [], new Set([1])).underline).toBe("lookup");
  });

  it("a token inside a Grammar Span is highlighted, stronger for a Focus Span", () => {
    expect(tokenMarks(token(), [span()]).grammar).toBe("grammar");
    expect(tokenMarks(token(), [span({ isFocus: true })]).grammar).toBe("grammarFocus");
    expect(tokenMarks(token(), [span({ start: 5, end: 9 })]).grammar).toBe("none");
  });
});

describe("furigana", () => {
  it("shows a reading only when the server's threshold says so and there is one", () => {
    expect(showsFurigana(token())).toBe(true);
    expect(showsFurigana(token({ showFurigana: false }))).toBe(false);
    expect(showsFurigana(token({ reading: "" }))).toBe(false);
    expect(showsFurigana(token({ reading: undefined }))).toBe(false);
  });

  it("the reading is half the word size at every Story text size", () => {
    expect([18, 21, 24, 28].map(furiganaPxFor)).toEqual([9, 10.5, 12, 14]);
  });
});

describe("sentenceSegments", () => {
  function sentence(ja: string, tokens: StoryToken[]): StorySentence {
    return { ja, en: "", tokens, grammarSpans: [] };
  }

  it("splices the punctuation the tokeniser left out between tokens", () => {
    const s = sentence("学校。", [token({ start: 0, end: 2 })]);
    expect(sentenceSegments(s)).toEqual([
      { kind: "token", token: s.tokens[0], index: 0 },
      { kind: "gap", text: "。", key: "gap-end" },
    ]);
  });

  it("counts codepoints, so astral characters do not shift the offsets", () => {
    // 𠮷 is one codepoint but two UTF-16 units; the token starts at codepoint 1.
    const s = sentence("𠮷。", [token({ surface: "。", start: 1, end: 2, entSeq: undefined })]);
    const segments = sentenceSegments(s);
    expect(segments[0]).toEqual({ kind: "gap", text: "𠮷", key: "gap-0" });
    expect(segments[1]).toMatchObject({ kind: "token", index: 0 });
  });
});

describe("pitchDots", () => {
  const pitch: PitchPattern = { reading: "がっこう", moraCount: 4, accentPosition: 3, heiban: false, downstepAfterMora: 3 };

  it("one dot per mora plus the trailing dot, high before the downstep", () => {
    const dots = pitchDots(pitch, 88, 36);
    expect(dots).toHaveLength(5);
    expect(dots.map((d) => d.y)).toEqual([8, 8, 24, 24, 24]);
  });

  it("heiban keeps every mora and the trailing dot high", () => {
    const flat = pitchDots({ ...pitch, accentPosition: 0, heiban: true, downstepAfterMora: 5 }, 88, 36);
    expect(flat.every((d) => d.y === 8)).toBe(true);
  });
});

describe("glosses", () => {
  const entry = {
    senses: [
      { glosses: ["school", "academy"], partsOfSpeech: ["n"] },
      { glosses: ["colloquial"], partsOfSpeech: [] },
    ],
  } as Parameters<typeof countGlosses>[0];

  it("counts and takes the first glosses across senses", () => {
    expect(countGlosses(entry)).toBe(3);
    expect(firstGlosses(entry, 2)).toEqual(["school", "academy"]);
  });
});
