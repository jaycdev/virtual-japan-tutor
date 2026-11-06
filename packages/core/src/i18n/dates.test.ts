// The ruby-aware date formatter (#125 round-3 review S3): readings over the
// kanji Intl puts into a Japanese date, the irregular day counters read as
// whole words, and en/ja byte-identical to the plain Intl string.

import { describe, expect, it } from "vitest";
import { formatDateRuby, rubyFromParts } from "./dates.ts";

const DATE = { year: "numeric", month: "long", day: "numeric" } as const;
const WITH_WEEKDAY = { year: "numeric", month: "long", day: "numeric", weekday: "long" } as const;

// Noon local time: the day number is never shifted by a timezone edge.
function noon(day: number): Date {
  return new Date(2026, 10, day, 12, 0, 0); // November 2026
}

describe("formatDateRuby", () => {
  it("reads every irregular day as one word over the number and 日", () => {
    const readings: Array<[number, string]> = [
      [1, "ついたち"],
      [2, "ふつか"],
      [3, "みっか"],
      [4, "よっか"],
      [5, "いつか"],
      [6, "むいか"],
      [7, "なのか"],
      [8, "ようか"],
      [9, "ここのか"],
      [10, "とおか"],
      [14, "じゅうよっか"],
      [20, "はつか"],
      [24, "にじゅうよっか"],
    ];
    for (const [day, reading] of readings) {
      expect(formatDateRuby(noon(day), DATE, "ja-furigana")).toEqual([
        { text: "2026" },
        { text: "年", ruby: "ねん" },
        { text: "11" },
        { text: "月", ruby: "がつ" },
        { text: `${day}日`, ruby: reading },
      ]);
    }
  });

  it("puts にち over the 日 alone for every other day", () => {
    for (const day of [11, 12, 15, 21, 25, 29, 30]) {
      expect(formatDateRuby(noon(day), DATE, "ja-furigana")).toEqual([
        { text: "2026" },
        { text: "年", ruby: "ねん" },
        { text: "11" },
        { text: "月", ruby: "がつ" },
        { text: `${day}` },
        { text: "日", ruby: "にち" },
      ]);
    }
  });

  it("reads each weekday over the whole word", () => {
    // 1 November 2026 is a Sunday, so the week runs 日〜土 in order.
    const weekdays: Array<[number, string, string]> = [
      [1, "日曜日", "にちようび"],
      [2, "月曜日", "げつようび"],
      [3, "火曜日", "かようび"],
      [4, "水曜日", "すいようび"],
      [5, "木曜日", "もくようび"],
      [6, "金曜日", "きんようび"],
      [7, "土曜日", "どようび"],
    ];
    for (const [day, word, reading] of weekdays) {
      const segments = formatDateRuby(noon(day), WITH_WEEKDAY, "ja-furigana");
      expect(segments[segments.length - 1]).toEqual({ text: word, ruby: reading });
    }
  });

  it("reads 時 and gives 分 ふん or ぷん by the minute", () => {
    // Current CLDR renders ja times as 14:01 — no 時分 for Intl to produce —
    // so the branch is driven with the parts a 時分 pattern would give.
    const parts = (minute: number): Intl.DateTimeFormatPart[] => [
      { type: "hour", value: "14" },
      { type: "literal", value: "時" },
      { type: "minute", value: String(minute).padStart(2, "0") },
      { type: "literal", value: "分" },
    ];
    for (const [minute, reading] of [
      [0, "ふん"],
      [1, "ぷん"],
      [2, "ふん"],
      [3, "ぷん"],
      [4, "ぷん"],
      [5, "ふん"],
      [6, "ぷん"],
      [7, "ふん"],
      [8, "ぷん"],
      [9, "ふん"],
      [10, "ぷん"],
      [21, "ぷん"],
      [25, "ふん"],
      [30, "ぷん"],
      [42, "ふん"],
    ] as const) {
      const segments = rubyFromParts(parts(minute));
      expect(segments[1]).toEqual({ text: "時", ruby: "じ" });
      expect(segments[3]).toEqual({ text: "分", ruby: reading });
    }
  });

  it("shows plain ja and en exactly as Intl.format says", () => {
    const iso = "2026-11-07T03:00:00Z";
    for (const [lang, locale] of [["ja", "ja-JP"], ["en", "en-US"]] as const) {
      for (const options of [DATE, WITH_WEEKDAY]) {
        const plain = new Intl.DateTimeFormat(locale, options).format(new Date(iso));
        expect(formatDateRuby(iso, options, lang)).toEqual([{ text: plain }]);
      }
    }
  });

  it("keeps the visible base text of ja-furigana equal to the plain ja string", () => {
    const when = noon(7);
    const options = WITH_WEEKDAY;
    const plain = new Intl.DateTimeFormat("ja-JP", options).format(when);
    const segments = formatDateRuby(when, options, "ja-furigana");
    expect(segments.map((s) => s.text).join("")).toBe(plain);
  });
});
