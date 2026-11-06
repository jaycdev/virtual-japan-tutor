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
  it("maps the English-mapped genres in English and shows the rest as typed", () => {
    expect(genreLabel("diary")).toBe("Diary");
    expect(genreLabel("travel")).toBe("Travel");
    expect(genreLabel("mystery")).toBe("Mystery");
    expect(genreLabel("Anything a Learner typed")).toBe("Anything a Learner typed");
    expect(genreLabel(null)).toBe("");
    expect(genreLabel(undefined)).toBe("");
  });

  it("reads both languages off one table, with the same case handling", () => {
    // The preset table is shared: English now covers the server presets too,
    // and both languages match case-insensitively (issue #125 review S16).
    expect(genreLabel("slice of life")).toBe("Slice of life");
    expect(genreLabel("Slice of Life")).toBe("Slice of life");
    expect(genreLabel("slice of life", "ja")).toBe("日常");
    expect(genreLabel("Slice of Life", "ja")).toBe("日常"); // same match, either language
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

  it("shows an unknown genre as stored, in either language", () => {
    expect(genreLabel("cyberpunk")).toBe("cyberpunk");
    expect(genreLabel("cyberpunk", "ja")).toBe("cyberpunk");
    expect(genreLabel("Cyberpunk")).toBe("Cyberpunk");
    expect(genreLabel("Cyberpunk", "ja")).toBe("Cyberpunk");
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
