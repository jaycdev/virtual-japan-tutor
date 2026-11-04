import { describe, expect, it } from "vitest";

import { displayPrompt, practiceSeedForStory } from "./practiceText.ts";

describe("displayPrompt", () => {
  it("glues a cloze blank to its punctuation and to the word before it", () => {
    const joined = displayPrompt("みせに いきました ＿＿＿。");
    expect(joined).toContain("＿＿＿\u2060。");
    expect(joined).toContain(" \u2060＿＿＿");
  });

  it("leaves prompts without a blank untouched", () => {
    expect(displayPrompt("学校")).toBe("学校");
  });
});

describe("practiceSeedForStory", () => {
  it("is deterministic, non-negative, safe, and specific to the Story", () => {
    expect(practiceSeedForStory("st-1")).toBe(practiceSeedForStory("st-1"));
    expect(practiceSeedForStory("st-1")).not.toBe(practiceSeedForStory("st-2"));
    expect(Number.isSafeInteger(practiceSeedForStory("st-1"))).toBe(true);
    expect(practiceSeedForStory("st-1")).toBeGreaterThanOrEqual(0);
  });
});
