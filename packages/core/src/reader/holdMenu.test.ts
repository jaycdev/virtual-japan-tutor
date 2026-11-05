import { describe, expect, it } from "vitest";

import type { StoryGrammarSpan, StorySentence, StoryToken } from "@vjt/api-client";

import {
  coveringSpan,
  grammarCue,
  hintOnly,
  holdSignal,
  IDLE,
  menuOptions,
  optionAt,
  reduceHold,
  saveableItem,
  shouldShrink,
  type HoldState,
} from "./holdMenu.ts";

function token(overrides: Partial<StoryToken> = {}): StoryToken {
  return {
    surface: "がっこう",
    start: 0,
    end: 4,
    reading: "がっこう",
    tag: "known",
    entSeq: 990101,
    showFurigana: false,
    ...overrides,
  } as StoryToken;
}

function span(overrides: Partial<StoryGrammarSpan> = {}): StoryGrammarSpan {
  return {
    start: 9,
    end: 13,
    grammarPointId: "12",
    isFocus: true,
    pattern: "～てしまう",
    meaning: "completing something; unfortunately doing",
    jlptLevel: "N4",
    ...overrides,
  } as StoryGrammarSpan;
}

const press = { type: "press", token: { sentence: 0, index: 1 }, x: 40, y: 120 } as const;

describe("reduceHold", () => {
  it("press anchors the menu at the press point", () => {
    const s = reduceHold(IDLE, press);
    expect(s).toEqual({ phase: "press", token: { sentence: 0, index: 1 }, anchorX: 40, anchorY: 120 });
  });

  it("holdElapsed opens the menu at the same anchor", () => {
    const s = reduceHold(IDLE, press);
    expect(s.phase).toBe("press");
    const menu = reduceHold(s, { type: "holdElapsed" });
    expect(menu.phase).toBe("menu");
    expect({ anchorX: menu.anchorX, anchorY: menu.anchorY }).toEqual({ anchorX: 40, anchorY: 120 });
  });

  it("a stale timer cannot open a menu after cancel or a new press", () => {
    const cancelled = reduceHold(reduceHold(IDLE, press), { type: "cancel" });
    expect(reduceHold(cancelled, { type: "holdElapsed" })).toBe(cancelled);
    const second = reduceHold(reduceHold(IDLE, press), {
      type: "press",
      token: { sentence: 1, index: 0 },
      x: 10,
      y: 20,
    });
    expect(second.token).toEqual({ sentence: 1, index: 0 });
    expect(second.anchorX).toBe(10);
  });

  it("cancel always returns to idle", () => {
    const held: HoldState = { ...reduceHold(IDLE, press), phase: "menu" };
    expect(reduceHold(held, { type: "cancel" })).toBe(IDLE);
  });
});

describe("optionAt", () => {
  const rects = {
    dictionary: { x: 40, y: 120, width: 160, height: 44 },
    save: { x: 40, y: 164, width: 160, height: 44 },
  };
  const options = [
    { id: "dictionary" as const, enabled: true },
    { id: "save" as const, enabled: true },
  ];

  it("finds the option a point sits inside, edges inclusive", () => {
    expect(optionAt(rects, options, 41, 121)).toBe("dictionary");
    expect(optionAt(rects, options, 200, 190)).toBe("save"); // right edge
    expect(optionAt(rects, options, 40, 208)).toBe("save"); // bottom edge
  });

  it("a point outside every option selects nothing", () => {
    expect(optionAt(rects, options, 41, 209)).toBeNull();
    expect(optionAt(rects, options, 39, 121)).toBeNull();
  });

  it("disabled and unmeasured options never take the release", () => {
    const off = [{ id: "dictionary" as const, enabled: false }, { id: "save" as const, enabled: true }];
    expect(optionAt(rects, off, 41, 121)).toBeNull();
    expect(optionAt({ save: rects.save }, options, 41, 121)).toBeNull();
  });
});

describe("menuOptions", () => {
  it("an unlinked word: everything but Save to… reads the same reason", () => {
    const opts = menuOptions(token({ entSeq: undefined }), null, true, "Saved");
    expect(opts.map((o) => [o.id, o.enabled])).toEqual([
      ["dictionary", false],
      ["save", false],
      ["saveTo", false],
    ]);
    expect(opts[0]?.hint).toBe("This word did not match a dictionary entry");
  });

  it("a Grammar Span token adds Grammar and keeps Dictionary reachable", () => {
    const opts = menuOptions(token(), span(), true, "Saved");
    expect(opts.map((o) => o.id)).toEqual(["dictionary", "grammar", "save", "saveTo"]);
    expect(opts[1]?.hint).toBe("～てしまう: completing something; unfortunately doing");
  });

  it("a span token without its own entry can still save the Grammar Point", () => {
    const opts = menuOptions(token({ entSeq: undefined }), span(), true);
    expect(opts.find((o) => o.id === "save")?.enabled).toBe(true);
    expect(opts.find((o) => o.id === "dictionary")?.enabled).toBe(false);
  });

  it("Save waits for the Item Lists to load", () => {
    const opts = menuOptions(token(), null, false);
    expect(opts.find((o) => o.id === "save")?.enabled).toBe(false);
    expect(opts.find((o) => o.id === "saveTo")?.enabled).toBe(false);
    expect(opts.find((o) => o.id === "save")?.hint).toBe("Your Item Lists are still loading");
  });

  it("Save names the Default List", () => {
    const opts = menuOptions(token(), null, true, "Saved");
    expect(opts.find((o) => o.id === "save")?.hint).toBe("Save to Saved");
  });
});

describe("saveableItem", () => {
  it("prefers the token's own dictionary entry", () => {
    expect(saveableItem(token(), span())).toEqual({ kind: "vocabulary", ref: "990101" });
  });

  it("falls back to the Span's Grammar Point, then to nothing", () => {
    expect(saveableItem(token({ entSeq: undefined }), span())).toEqual({ kind: "grammar", ref: "12" });
    expect(saveableItem(token({ entSeq: undefined }), null)).toBeNull();
  });
});

describe("holdSignal", () => {
  it("a span token signals its Grammar Point", () => {
    expect(holdSignal(token(), span())).toEqual({ itemKind: "grammar", itemRef: "12", reason: "lookup" });
  });

  it("a plain token signals its dictionary entry, whatever its tag", () => {
    expect(holdSignal(token({ tag: "unknown" }), null)).toEqual({
      itemKind: "vocabulary",
      itemRef: "990101",
      reason: "lookup",
    });
  });

  it("an unlinked word signals nothing", () => {
    expect(holdSignal(token({ entSeq: undefined }), null)).toBeNull();
  });
});

describe("coveringSpan", () => {
  const sentence = {
    ja: "みせにいきました。",
    en: "I went to the shop.",
    tokens: [],
    grammarSpans: [span({ start: 2, end: 4 })],
  } as StorySentence;

  it("matches on overlapping codepoint ranges", () => {
    expect(coveringSpan(sentence, token({ start: 2, end: 3 }))).not.toBeNull();
    expect(coveringSpan(sentence, token({ start: 3, end: 5 }))).not.toBeNull();
    expect(coveringSpan(sentence, token({ start: 0, end: 2 }))).toBeNull(); // touching, not overlapping
    expect(coveringSpan(sentence, token({ start: 4, end: 7 }))).toBeNull();
  });
});

describe("grammarCue and hintOnly (issue #98 particles)", () => {
  const hint: NonNullable<StoryToken["grammarHint"]> = {
    grammarPointId: "7",
    pattern: "は",
    meaning: "topic marker",
    jlptLevel: "N5",
  };
  const particle = token({ surface: "は", entSeq: undefined, grammarHint: hint });
  const sentence = {
    ja: "x",
    en: "x",
    tokens: [],
    grammarSpans: [span({ start: 0, end: 2 })],
  } as StorySentence;

  it("cues a particle by its hint, with no span", () => {
    expect(grammarCue(particle, null)).toEqual(hint);
  });

  it("prefers a covering Grammar Span over a hint", () => {
    const covering = coveringSpan(sentence, particle);
    expect(grammarCue(particle, covering)).toBe(covering);
  });

  it("cues nothing for an unlinked word with no hint and no span", () => {
    expect(grammarCue(token({ entSeq: undefined }), null)).toBeNull();
  });

  it("is hint-only for a particle with nothing else behind it, and never for a linked word or a span", () => {
    expect(hintOnly(particle, null)).toBe(true);
    expect(hintOnly(particle, span())).toBe(false); // a span is a menu target
    expect(hintOnly(token(), null)).toBe(false); // a linked word
    expect(hintOnly(token({ entSeq: undefined }), null)).toBe(false); // unlinked, no hint: unchanged
  });
});

describe("shouldShrink", () => {
  it("shrinks only on real overflow, never on unmeasured zero heights", () => {
    expect(shouldShrink(200, 96)).toBe(true);
    expect(shouldShrink(96, 96)).toBe(false);
    expect(shouldShrink(0, 0)).toBe(false);
    expect(shouldShrink(120, 0)).toBe(false);
  });
});
