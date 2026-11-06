import type { Story } from "@vjt/api-client";
import { describe, expect, it } from "vitest";

import { formatInstant, formatInstantRuby, greetingFor, greetingRubyFor, learnerClock, learnerClockRuby, learnerGreetingRuby, localDayKey, normalizeTimezone, stillUnreadFrom, stillUnreadFromRuby } from "./learnerTime.ts";

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

// #125 round-4 review A3: the sync line's {time} param is interface text too.
describe("formatInstantRuby", () => {
  it("reads the date kanji in furigana and keeps the visible base equal to formatInstant", () => {
    const iso = "2026-11-04T05:02:00Z"; // Wed 4 Nov 14:02 in Tokyo
    const furigana = formatInstantRuby(iso, "Asia/Tokyo", "ja-furigana");
    expect(furigana.map((s) => s.text).join("")).toBe(formatInstant(iso, "Asia/Tokyo", "ja"));
    expect(furigana.some((s) => s.text === "月" && s.ruby === "がつ")).toBe(true);
    expect(furigana.some((s) => s.text === "4日" && s.ruby === "よっか")).toBe(true);
  });

  it("en and ja are the one plain segment formatInstant speaks", () => {
    const iso = "2026-11-04T05:02:00Z";
    expect(formatInstantRuby(iso, "Asia/Tokyo", "en")).toEqual([{ text: "November 4, 14:02" }]);
    expect(formatInstantRuby(iso, "Asia/Tokyo", "ja")).toEqual([{ text: "11月4日 14:02" }]);
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

  // #125 round-4 review A3: the storyStillUnread {date} param carries ruby.
  it("reads the weekday in furigana, and stays the plain string otherwise", () => {
    expect(stillUnreadFromRuby(story(), now, "Asia/Tokyo")).toEqual([{ text: "Monday" }]);
    expect(stillUnreadFromRuby(story(), now, "Asia/Tokyo", "ja")).toEqual([{ text: "月曜日" }]);
    expect(stillUnreadFromRuby(story(), now, "Asia/Tokyo", "ja-furigana")).toEqual([
      { text: "月曜日", ruby: "げつようび" },
    ]);
    expect(stillUnreadFromRuby(story({ readAt: "2026-11-03T10:00:00Z" }), now, "Asia/Tokyo", "ja-furigana")).toBeNull();
  });
});

// Issue #125: with an Interface Language passed, the clock itself speaks it,
// while the internal YYYY-MM-DD keys stay en-CA whatever the UI shows.
describe("the clock in Japanese", () => {
  it("greets in Japanese, furigana included", () => {
    expect(greetingFor("09", "ja")).toBe("おはようございます");
    expect(greetingFor("23", "ja-furigana")).toBe("遅くまで勉強中ですね");
  });

  it("keeps the greeting's readings as segments for screens that draw ruby", () => {
    // review S5 follow-up: the Today header draws the greeting through
    // <TableText>, so translatePlain's dropped readings are not enough.
    const segments = greetingRubyFor("23", "ja-furigana");
    expect(segments.map((s) => s.text).join("")).toBe("遅くまで勉強中ですね");
    expect(segments.some((s) => s.ruby === "べんきょうちゅう")).toBe(true);
    // English has no readings: the segments are just the sentence.
    expect(greetingRubyFor("09", "en").every((s) => !s.ruby)).toBe(true);
    // The Learner's Timezone picks the same greeting as learnerClock.
    const now = new Date("2026-11-03T22:30:00Z"); // Wed 4 Nov, 07:30 in Tokyo
    expect(learnerGreetingRuby(now, "Asia/Tokyo", "ja").map((s) => s.text).join("")).toBe("おはようございます");
  });

  it("orders the Today greeting and date as ja-JP", () => {
    const now = new Date("2026-11-03T22:30:00Z"); // Wed 4 Nov, 07:30 in Tokyo
    expect(learnerClock(now, "Asia/Tokyo", "ja")).toEqual({
      greeting: "おはようございます",
      date: "2026年11月4日水曜日",
    });
  });

  // #125 round-3 review S3.
  it("reads the date's kanji in furigana and keeps the plain forms untouched", () => {
    const now = new Date("2026-11-03T22:30:00Z"); // Wed 4 Nov, 07:30 in Tokyo
    const ruby = learnerClockRuby(now, "Asia/Tokyo", "ja-furigana");
    // Visible base text equals the plain ja string, byte for byte.
    expect(ruby.date.map((s) => s.text).join("")).toBe("2026年11月4日水曜日");
    // 4日 is one irregular word; the weekday sits over the whole name.
    expect(ruby.date.some((s) => s.text === "4日" && s.ruby === "よっか")).toBe(true);
    expect(ruby.date.some((s) => s.text === "年" && s.ruby === "ねん")).toBe(true);
    expect(ruby.date.some((s) => s.text === "水曜日" && s.ruby === "すいようび")).toBe(true);
    expect(ruby.greeting.some((s) => s.text === "おはようございます")).toBe(true);
    // en and plain ja are the exact strings learnerClock already speaks.
    expect(learnerClockRuby(now, "Asia/Tokyo", "ja")).toEqual({
      greeting: [{ text: "おはようございます" }],
      date: [{ text: "2026年11月4日水曜日" }],
    });
    expect(learnerClockRuby(now, "Asia/Tokyo", "en")).toEqual({
      greeting: [{ text: "Good morning" }],
      date: [{ text: "Wednesday, November 4" }],
    });
  });

  it("formats an instant as ja-JP", () => {
    expect(formatInstant("2026-11-04T05:02:00Z", "Asia/Tokyo", "ja")).toBe("11月4日 14:02");
  });

  it("keeps the day keys plain YYYY-MM-DD for a Japanese UI", () => {
    expect(localDayKey(new Date("2026-11-03T20:00:00Z"), "Asia/Tokyo")).toBe("2026-11-04");
  });
});
