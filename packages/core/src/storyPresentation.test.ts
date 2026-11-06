// Genre names and Library card lines in the Learner's language (issue #125).
// Display only: what is stored and sent stays the English genre id.

import type { Story } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { genreLabel, originLabel, storyCardMeta, storyDate } from "./storyPresentation.ts";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "s1",
    title: "猫",
    genre: "diary",
    text: "猫です。",
    sentences: [],
    questions: [],
    vocabItems: [],
    createdAt: "2026-11-01T09:00:00Z",
    origin: "automatic",
    ...overrides,
  } as Story;
}

describe("genreLabel", () => {
  it("maps only diary, travel and mystery in English and shows the rest as typed", () => {
    expect(genreLabel("diary")).toBe("Diary");
    expect(genreLabel("travel")).toBe("Travel");
    expect(genreLabel("mystery")).toBe("Mystery");
    expect(genreLabel("slice of life")).toBe("slice of life");
    expect(genreLabel("Anything a Learner typed")).toBe("Anything a Learner typed");
    expect(genreLabel(null)).toBe("");
    expect(genreLabel(undefined)).toBe("");
  });

  it("matches the English genre ids exactly as stored, like the old switch", () => {
    expect(genreLabel("DIARY")).toBe("DIARY");
    expect(genreLabel("Diary")).toBe("Diary"); // as typed, not through the table
    expect(genreLabel("Travel")).toBe("Travel");
  });

  it("shows a genre that shadows Object.prototype exactly as typed", () => {
    // A plain object lookup would answer with the prototype member itself;
    // the table must only trust its own rows (issue #125 review N1).
    for (const lang of ["en", "ja"] as const) {
      expect(genreLabel("constructor", lang)).toBe("constructor");
      expect(genreLabel("toString", lang)).toBe("toString");
    }
  });

  it("shows the other presets exactly as stored in English", () => {
    // English byte-identity with the copy before the Interface Language work
    // (issue #125 review R4): only the en table above maps, and it holds just
    // three genres.
    expect(genreLabel("slice of life")).toBe("slice of life");
    expect(genreLabel("Slice of Life")).toBe("Slice of Life");
    expect(genreLabel("folktale")).toBe("folktale");
    expect(genreLabel("food")).toBe("food");
    expect(genreLabel("school life")).toBe("school life");
    expect(genreLabel("city life")).toBe("city life");
    expect(genreLabel("nature")).toBe("nature");
  });

  it("names every server preset genre in Japanese", () => {
    expect(genreLabel("slice of life", "ja")).toBe("日常");
    expect(genreLabel("folktale", "ja")).toBe("昔話");
    expect(genreLabel("travel", "ja")).toBe("旅行");
    expect(genreLabel("food", "ja")).toBe("食べ物");
    expect(genreLabel("school life", "ja")).toBe("学校生活");
    expect(genreLabel("city life", "ja")).toBe("都会");
    expect(genreLabel("nature", "ja")).toBe("自然");
    expect(genreLabel("diary", "ja")).toBe("日記");
    expect(genreLabel("mystery", "ja")).toBe("ミステリー");
  });

  it("shows an unknown genre as typed in Japanese too", () => {
    expect(genreLabel("cyberpunk", "ja")).toBe("cyberpunk");
    expect(genreLabel("Slice of Life", "ja")).toBe("日常"); // presets are matched case-insensitively
  });
});

describe("the Library card line", () => {
  it("says today's English copy byte for byte", () => {
    expect(storyCardMeta(story())).toBe("Diary · Automatic · Nov 1, 2026");
    expect(originLabel(story({ origin: "on_demand" }))).toBe("On demand");
  });

  it("fills a missing Genre with the word for Story", () => {
    expect(storyCardMeta(story({ genre: undefined }))).toBe("Story · Automatic · Nov 1, 2026");
  });

  it("says the same card in Japanese, date in ja-JP", () => {
    expect(storyCardMeta(story(), "ja")).toBe("日記 · 自動生成 · 2026年11月1日");
    expect(storyCardMeta(story({ genre: undefined }), "ja-furigana")).toBe("物語 · 自動生成 · 2026年11月1日");
    expect(storyDate("2026-11-01T09:00:00Z", "ja")).toBe("2026年11月1日");
  });
});
