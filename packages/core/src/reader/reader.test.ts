import type { PitchPattern, StoryGrammarSpan, StoryPhrase, StorySentence, StoryToken } from "@vjt/api-client";
import { describe, expect, it } from "vitest";

import { showsFurigana, furiganaPxFor } from "./furigana.ts";
import {
  coveringPhrase,
  dictionaryKey,
  dictionaryKeys,
  isLookupMarked,
  lookupKey,
  phraseMarkFor,
  phrasesCovering,
  sentencePhraseMarks,
  tokenMarks,
  withPhraseMark,
} from "./marks.ts";
import { pitchDots } from "./pitch.ts";
import { phraseRuns, sentenceSegments } from "./sentences.ts";
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

describe("phrases", () => {
  // この頃 at runes [0,3) of "この頃は": the tokens この [0,2) and 頃 [2,3).
  const konogoro: StoryPhrase = { start: 0, end: 3, entSeq: 1000001, ja: "この頃", en: "these days" };

  it("a token is covered by a phrase it overlaps; touching is not covering", () => {
    expect(phrasesCovering(token({ start: 0, end: 2 }), [konogoro])).toEqual([konogoro]);
    expect(phrasesCovering(token({ start: 2, end: 3 }), [konogoro])).toEqual([konogoro]);
    expect(phrasesCovering(token({ start: 3, end: 4 }), [konogoro])).toEqual([]);
  });

  it("coveringPhrase names the phrase over a token, or null when none covers it", () => {
    const sentence = { ja: "この頃は", en: "", tokens: [], grammarSpans: [], phrases: [konogoro] } as StorySentence;
    expect(coveringPhrase(sentence, token({ start: 2, end: 3 }))).toEqual(konogoro);
    expect(coveringPhrase(sentence, token({ start: 3, end: 4 }))).toBeNull();
  });

  it("a word's Lookup loads its phrase's entry, unless a Grammar Span claims the word", () => {
    const sentence = { ja: "この頃は", en: "", tokens: [], grammarSpans: [], phrases: [konogoro] } as StorySentence;
    const kono = token({ start: 0, end: 2, surface: "この", reading: "この", entSeq: 990101 });
    const goro = token({ start: 2, end: 3, surface: "頃", reading: "ころ", entSeq: 990102 });
    // The phrase's entry and text, with no reading of its own, for every part.
    expect(lookupKey(sentence, kono, null)).toEqual({ entSeq: 1000001, surface: "この頃", reading: "" });
    expect(lookupKey(sentence, goro, null)).toEqual({ entSeq: 1000001, surface: "この頃", reading: "" });
    // A Grammar Span over the word keeps the word's own entry.
    expect(lookupKey(sentence, goro, span({ start: 2, end: 3 }))).toEqual({ entSeq: 990102, surface: "頃", reading: "ころ" });
    // A word with no entry and no phrase has no Lookup key.
    expect(lookupKey(sentence, token({ start: 3, end: 4, surface: "は", entSeq: undefined }), null)).toBeNull();
  });

  it("each Dictionary row opens its own key: the word's entry, or the Phrase's (issue #97)", () => {
    const sentence = { ja: "この頃は", en: "", tokens: [], grammarSpans: [], phrases: [konogoro] } as StorySentence;
    const goro = token({ start: 2, end: 3, surface: "頃", reading: "ころ", entSeq: 990106 });
    expect(dictionaryKey(sentence, goro, null, "dictionary")).toEqual({ entSeq: 990106, surface: "頃", reading: "ころ" });
    expect(dictionaryKey(sentence, goro, null, "phraseDictionary")).toEqual({
      entSeq: 1000001,
      surface: "この頃",
      reading: "",
    });
    expect(dictionaryKeys(sentence, goro, null)).toEqual([
      { entSeq: 990106, surface: "頃", reading: "ころ" },
      { entSeq: 1000001, surface: "この頃", reading: "" },
    ]);
  });

  it("a phrase word with no entry of its own has only the Phrase's key, and a Grammar Span takes the Phrase row away (issue #97)", () => {
    const sentence = { ja: "この頃は", en: "", tokens: [], grammarSpans: [], phrases: [konogoro] } as StorySentence;
    const goro = token({ start: 2, end: 3, surface: "頃", reading: "ころ", entSeq: undefined });
    expect(dictionaryKeys(sentence, goro, null)).toEqual([{ entSeq: 1000001, surface: "この頃", reading: "" }]);
    const own = token({ start: 2, end: 3, surface: "頃", reading: "ころ", entSeq: 990106 });
    const grammar = span({ start: 2, end: 3 });
    expect(dictionaryKey(sentence, own, grammar, "phraseDictionary")).toBeNull();
    expect(dictionaryKeys(sentence, own, grammar)).toEqual([{ entSeq: 990106, surface: "頃", reading: "ころ" }]);
  });

  it("a word outside any phrase has just its own key", () => {
    const sentence = { ja: "この頃は", en: "", tokens: [], grammarSpans: [], phrases: [konogoro] } as StorySentence;
    const wa = token({ start: 3, end: 4, surface: "は", reading: "は", entSeq: 990107 });
    expect(dictionaryKeys(sentence, wa, null)).toEqual([{ entSeq: 990107, surface: "は", reading: "は" }]);
    expect(dictionaryKey(sentence, wa, null, "phraseDictionary")).toBeNull();
  });
});

describe("phrase mark (issue #97)", () => {
  // この頃は: この [0,2) and 頃 [2,3) form the phrase 「この頃」 [0,3); は [3,4) is outside it.
  const konogoro: StoryPhrase = { start: 0, end: 3, entSeq: 1000001, ja: "この頃", en: "these days" };
  const kono = token({ start: 0, end: 2, surface: "この", reading: "この", entSeq: 990101, tag: "unknown" });
  const goro = token({ start: 2, end: 3, surface: "頃", reading: "ころ", entSeq: 990102, tag: "unknown" });
  const wa = token({ start: 3, end: 4, surface: "は", reading: "は", entSeq: undefined, tag: undefined });

  function sentenceOf(tokens: StoryToken[], phrases: StoryPhrase[] = [konogoro], grammarSpans: StoryGrammarSpan[] = []): StorySentence {
    return { ja: "この頃は", en: "", tokens, grammarSpans, phrases };
  }

  it("a phrase with one non-Known token marks every token of it, Known ones included", () => {
    const s = sentenceOf([kono, { ...goro, tag: "known" }, wa]);
    expect(phraseMarkFor(s, s.tokens[0]!, null).underline).toBe(true);
    expect(phraseMarkFor(s, s.tokens[1]!, null).underline).toBe(true);
  });

  it("an all-Known phrase gets no phrase mark", () => {
    const s = sentenceOf([{ ...kono, tag: "known" }, { ...goro, tag: "known" }, wa]);
    expect(phraseMarkFor(s, s.tokens[0]!, null).underline).toBe(false);
    expect(phraseMarkFor(s, s.tokens[1]!, null).underline).toBe(false);
  });

  it("a token outside any phrase gets no phrase mark", () => {
    const s = sentenceOf([kono, goro, wa]);
    expect(phraseMarkFor(s, s.tokens[2]!, null)).toEqual({ underline: false, first: false, last: false });
  });

  it("a 2-token phrase: the first token is first, the last is last", () => {
    const s = sentenceOf([kono, goro, wa]);
    expect(phraseMarkFor(s, kono, null)).toEqual({ underline: true, first: true, last: false });
    expect(phraseMarkFor(s, goro, null)).toEqual({ underline: true, first: false, last: true });
  });

  it("a 3-token phrase: first, middle and last", () => {
    const a = token({ start: 0, end: 1, surface: "一", reading: "いち", entSeq: 990201, tag: "unknown" });
    const b = token({ start: 1, end: 2, surface: "二", reading: "に", entSeq: 990202, tag: "unknown" });
    const c = token({ start: 2, end: 3, surface: "三", reading: "さん", entSeq: 990203, tag: "unknown" });
    const phrase: StoryPhrase = { start: 0, end: 3, entSeq: 1000002, ja: "一二三", en: "one two three" };
    const s = { ja: "一二三", en: "", tokens: [a, b, c], grammarSpans: [], phrases: [phrase] } as StorySentence;
    expect(phraseMarkFor(s, a, null)).toEqual({ underline: true, first: true, last: false });
    expect(phraseMarkFor(s, b, null)).toEqual({ underline: true, first: false, last: false });
    expect(phraseMarkFor(s, c, null)).toEqual({ underline: true, first: false, last: true });
  });

  it("a token under a Grammar Span keeps its own marking: no phrase mark", () => {
    const s = sentenceOf([kono, goro, wa], [konogoro], [span({ start: 2, end: 3 })]);
    expect(phraseMarkFor(s, goro, s.grammarSpans[0]!).underline).toBe(false);
  });

  it("withPhraseMark turns a Known token's underline into the lookup one, and leaves the rest alone", () => {
    const known = { grammar: "none", underline: "none" } as const;
    expect(withPhraseMark(known, { underline: true, first: false, last: false }).underline).toBe("lookup");
    expect(withPhraseMark(known, { underline: false, first: false, last: false })).toEqual(known);
    const grammar = { grammar: "grammar", underline: "none" } as const;
    expect(withPhraseMark(grammar, { underline: true, first: true, last: true }).grammar).toBe("grammar");
  });

  it("withPhraseMark keeps a Focus underline inside a phrase run (issue #97)", () => {
    const focus = { grammar: "none", underline: "focus" } as const;
    expect(withPhraseMark(focus, { underline: true, first: false, last: true }).underline).toBe("focus");
  });

  it("sentencePhraseMarks gives every token its phrase mark, in token order, from one pass over the sentence", () => {
    const s = sentenceOf([kono, goro, wa]);
    expect(sentencePhraseMarks(s)).toEqual([
      { underline: true, first: true, last: false },
      { underline: true, first: false, last: true },
      { underline: false, first: false, last: false },
    ]);
  });

  it("phraseRuns joins a phrase's consecutive tokens into one run, and a Grammar Span breaks it into two", () => {
    const a = token({ start: 0, end: 1, surface: "一", reading: "いち", entSeq: 990201, tag: "unknown" });
    const b = token({ start: 1, end: 2, surface: "二", reading: "に", entSeq: 990202, tag: "unknown" });
    const c = token({ start: 2, end: 3, surface: "三", reading: "さん", entSeq: 990203, tag: "unknown" });
    const d = token({ start: 3, end: 4, surface: "は", reading: "は", entSeq: undefined, tag: undefined });
    const phrase: StoryPhrase = { start: 0, end: 3, entSeq: 1000002, ja: "一二三", en: "one two three" };
    const whole = { ja: "一二三は", en: "", tokens: [a, b, c, d], grammarSpans: [], phrases: [phrase] } as StorySentence;
    const shape = (s: StorySentence) =>
      phraseRuns(sentenceSegments(s), sentencePhraseMarks(s)).map((seg) =>
        seg.kind === "run" ? ["run", seg.members.map((m) => m.index)] : seg.kind === "token" ? ["token", seg.index] : ["gap"],
      );
    expect(shape(whole)).toEqual([["run", [0, 1, 2]], ["token", 3]]);

    // The Grammar Span over 二 leaves 一 and 三 in the phrase, but not joined.
    const broken = { ...whole, grammarSpans: [span({ start: 1, end: 2 })] } as StorySentence;
    expect(shape(broken)).toEqual([["run", [0]], ["token", 1], ["run", [2]], ["token", 3]]);
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
    return { ja, en: "", tokens, grammarSpans: [], phrases: [] };
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
