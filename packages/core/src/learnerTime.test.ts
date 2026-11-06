import type { Story } from "@vjt/api-client";
import { describe, expect, it } from "vitest";

import { formatInstant, greetingFor, learnerClock, localDayKey, normalizeTimezone, stillUnreadFrom } from "./learnerTime.ts";

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "s1",
    title: "猫",
    genre: "diary",
    text: "猫です。",
    sentences: [],
    questions: [],
    vocabItems: [],
    createdAt: "2026-11-02T12:00:00Z",
    origin: "automatic",
    ...overrides,
  } as Story;
}

describe("learnerClock", () => {
  it("reads the hour and day in the named zone", () => {
    // 2026-11-04 07:30 in Tokyo is 2026-11-03 22:30 in UTC.
    const now = new Date("2026-11-03T22:30:00Z");
    expect(learnerClock(now, "Asia/Tokyo")).toEqual({ greeting: "Good morning", date: "Wednesday, November 4" });
  });

  it("uses the earlier day for a Learner west of the instant", () => {
    const now = new Date("2026-11-04T02:00:00Z");
    expect(learnerClock(now, "America/Los_Angeles").date).toBe("Tuesday, November 3");
  });

  it("follows the device when the zone is unset or unknown", () => {
    const now = new Date(2026, 10, 4, 9, 0, 0);
    expect(learnerClock(now, undefined).greeting).toBe("Good morning");
    expect(learnerClock(now, "Not/AZone").greeting).toBe("Good morning");
  });
});

describe("greetingFor", () => {
  it("splits the day and gives the small hours their own greeting", () => {
    expect(greetingFor("05")).toBe("Good morning");
    expect(greetingFor("12")).toBe("Good afternoon");
    expect(greetingFor("18")).toBe("Good evening");
    expect(greetingFor("23")).toBe("Still studying");
    expect(greetingFor("24")).toBe("Still studying");
    expect(greetingFor("nope")).toBe("Hello");
  });
});

describe("formatInstant", () => {
  it("formats an instant in the Learner's zone", () => {
    expect(formatInstant("2026-11-04T05:02:00Z", "Asia/Tokyo")).toBe("November 4, 14:02");
  });

  it("normalizes unknown zone names to the device's", () => {
    expect(normalizeTimezone("Not/AZone")).toBeUndefined();
    expect(normalizeTimezone("")).toBeUndefined();
    expect(normalizeTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

describe("localDayKey", () => {
  it("gives the calendar day in the zone", () => {
    const instant = new Date("2026-11-03T20:00:00Z");
    expect(localDayKey(instant, "Asia/Tokyo")).toBe("2026-11-04");
    expect(localDayKey(instant, "UTC")).toBe("2026-11-03");
  });
});

describe("stillUnreadFrom", () => {
  const now = new Date("2026-11-04T03:00:00Z"); // Wed 4 Nov, 12:00 in Tokyo

  it("names the weekday of an unread Automatic Story from an earlier day", () => {
    // Created Mon 2 Nov 12:00 UTC, which is Mon 2 Nov in Tokyo.
    expect(stillUnreadFrom(story(), now, "Asia/Tokyo")).toBe("Monday");
  });

  it("says nothing for a Story from today, a read Story, or an On-demand Story", () => {
    expect(stillUnreadFrom(story({ createdAt: "2026-11-04T01:00:00Z" }), now, "Asia/Tokyo")).toBeNull();
    expect(stillUnreadFrom(story({ readAt: "2026-11-03T10:00:00Z" }), now, "Asia/Tokyo")).toBeNull();
    expect(stillUnreadFrom(story({ origin: "on_demand" }), now, "Asia/Tokyo")).toBeNull();
  });

  it("names the unread weekday in Japanese too", () => {
    expect(stillUnreadFrom(story(), now, "Asia/Tokyo", "ja")).toBe("月曜日");
  });
});

// Issue #125: with an Interface Language passed, the clock itself speaks it,
// while the internal YYYY-MM-DD keys stay en-CA whatever the UI shows.
describe("the clock in Japanese", () => {
  it("greets in Japanese, furigana included", () => {
    expect(greetingFor("09", "ja")).toBe("おはようございます");
    expect(greetingFor("23", "ja-furigana")).toBe("遅くまで勉強中ですね");
  });

  it("orders the Today greeting and date as ja-JP", () => {
    const now = new Date("2026-11-03T22:30:00Z"); // Wed 4 Nov, 07:30 in Tokyo
    expect(learnerClock(now, "Asia/Tokyo", "ja")).toEqual({
      greeting: "おはようございます",
      date: "2026年11月4日水曜日",
    });
  });

  it("formats an instant as ja-JP", () => {
    expect(formatInstant("2026-11-04T05:02:00Z", "Asia/Tokyo", "ja")).toBe("11月4日 14:02");
  });

  it("keeps the day keys plain YYYY-MM-DD for a Japanese UI", () => {
    expect(localDayKey(new Date("2026-11-03T20:00:00Z"), "Asia/Tokyo")).toBe("2026-11-04");
  });
});
