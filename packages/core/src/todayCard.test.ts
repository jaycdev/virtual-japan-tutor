import type { Story, StoryGenerationProgress } from "@vjt/api-client";
import { describe, expect, it } from "vitest";

import { FAILED_RUN_FALLBACK, todayCardPhase } from "./todayCard.ts";
import { progressLabel, storyCardMeta } from "./storyPresentation.ts";
import type { StoryGenerationState } from "./useStoryGeneration.ts";
import type { TodaysStoryState } from "./useStory.ts";

const story = { id: "s1", title: "猫", genre: "diary", origin: "automatic", createdAt: "2026-11-04T01:00:00Z" } as Story;
const writing: StoryGenerationProgress = { status: "running", stage: "writing", percent: 40 };
const idle: StoryGenerationState = { status: "idle" };
const running: StoryGenerationState = { status: "running", progress: writing };
const failed: StoryGenerationState = { status: "failed", progress: { status: "failed", percent: 0 } };
const storyState: TodaysStoryState = { status: "story", story };

describe("todayCardPhase: the Today card cascade (issue #71)", () => {
  it("is loading while today's read is in flight, whatever the run is doing", () => {
    expect(todayCardPhase({ status: "loading" }, running)).toEqual({ kind: "loading" });
  });

  it("shows the Story, and says a newer one is being written when a run is live", () => {
    expect(todayCardPhase(storyState, idle)).toEqual({ kind: "story", story, running: null });
    expect(todayCardPhase(storyState, running)).toEqual({ kind: "story", story, running: writing });
  });

  it("shows the run when there is no Story on screen yet", () => {
    expect(todayCardPhase({ status: "none" }, running)).toEqual({ kind: "running", progress: writing });
  });

  it("reports a failed read in place, ahead of a failed run", () => {
    expect(todayCardPhase({ status: "error", message: "offline" }, failed)).toEqual({
      kind: "error",
      message: "offline",
    });
  });

  it("reports a failed run with the server's own words, or the fallback", () => {
    const withWords: StoryGenerationState = {
      status: "failed",
      progress: { status: "failed", percent: 0, message: "Couldn't write a Story that fits your vocabulary." },
    };
    expect(todayCardPhase({ status: "none" }, withWords)).toEqual({
      kind: "failed",
      message: "Couldn't write a Story that fits your vocabulary.",
    });
    expect(todayCardPhase({ status: "none" }, failed)).toEqual({ kind: "failed", message: FAILED_RUN_FALLBACK });
  });

  it("is empty when there is no Story and nothing has run or failed", () => {
    expect(todayCardPhase({ status: "none" }, idle)).toEqual({ kind: "empty" });
  });
});

describe("storyCardMeta and progressLabel", () => {
  it("reads Genre, Story Origin and the date, with Story standing in for a missing Genre", () => {
    expect(storyCardMeta(story)).toMatch(/^Diary · Automatic · /);
    expect(storyCardMeta({ ...story, genre: null } as unknown as Story)).toMatch(/^Story · Automatic · /);
    expect(storyCardMeta({ ...story, origin: "on_demand" } as Story)).toContain("On demand");
  });

  it("names the stage and the rounded percent", () => {
    expect(progressLabel({ status: "running", stage: "writing", attempt: 2, maxAttempts: 3, percent: 40.6 })).toBe(
      "Writing… attempt 2 of 3 41%",
    );
  });
});
