// Dates in the Interface Language (issue #125 round-3 review S3): the kanji
// Intl.DateTimeFormat writes into a Japanese date — 年月日, the weekdays, 時分
// — are interface chrome, so ja-furigana puts a reading over each of them.
// Those readings are date grammar, not sentence copy (the day 日 changes
// reading with its number), so they live here rather than in the string
// table. English and plain Japanese pass through the Intl string exactly as
// format() gives it, byte for byte.

import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./language.ts";
import type { RubyText } from "./ruby.ts";

const WEEKDAY_READINGS: Record<string, string> = {
  日曜日: "にちようび",
  月曜日: "げつようび",
  火曜日: "かようび",
  水曜日: "すいようび",
  木曜日: "もくようび",
  金曜日: "きんようび",
  土曜日: "どようび",
};

// The days whose whole "N日" is one irregular word. Over these the reading
// covers number and 日 together (｜7日《なのか》); every other day reads にち,
// which sits over the 日 alone.
const IRREGULAR_DAY_READINGS: Record<number, string> = {
  1: "ついたち",
  2: "ふつか",
  3: "みっか",
  4: "よっか",
  5: "いつか",
  6: "むいか",
  7: "なのか",
  8: "ようか",
  9: "ここのか",
  10: "とおか",
  14: "じゅうよっか",
  20: "はつか",
  24: "にじゅうよっか",
};

/** 分 by number: endings 1, 3, 4, 6, 8 and whole tens voice it ぷん. */
function minuteReading(minute: number): string {
  const ending = minute % 10;
  const voiced = ending === 1 || ending === 3 || ending === 4 || ending === 6 || ending === 8 || (ending === 0 && minute !== 0);
  return voiced ? "ぷん" : "ふん";
}

/** One ja-JP formatToParts run, turned into base/reading segments. Exported
 * for the unit tests: current CLDR writes ja times as 14:01, so the 時分
 * branch is driven by handing it parts directly. */
export function rubyFromParts(parts: Intl.DateTimeFormatPart[]): RubyText {
  const out: RubyText = [];
  let dayText: string | null = null;
  let minute = 0;
  for (const part of parts) {
    switch (part.type) {
      case "day":
        dayText = part.value;
        out.push({ text: part.value });
        break;
      case "minute":
        minute = Number.parseInt(part.value, 10) || 0;
        out.push({ text: part.value });
        break;
      case "weekday":
        out.push({ text: part.value, ruby: WEEKDAY_READINGS[part.value] });
        break;
      case "literal": {
        const kanji = part.value;
        if (kanji === "年") out.push({ text: kanji, ruby: "ねん" });
        else if (kanji === "月") out.push({ text: kanji, ruby: "がつ" });
        else if (kanji === "時") out.push({ text: kanji, ruby: "じ" });
        else if (kanji === "分") out.push({ text: kanji, ruby: minuteReading(minute) });
        else if (kanji === "日" && dayText !== null) {
          const reading = IRREGULAR_DAY_READINGS[Number.parseInt(dayText, 10)];
          if (reading) {
            // One word: replace the bare number with number+日 under the full reading.
            out[out.length - 1] = { text: `${dayText}日`, ruby: reading };
          } else {
            out.push({ text: kanji, ruby: "にち" });
          }
          dayText = null;
        } else out.push({ text: kanji }); // separators: spaces, commas, colons
        break;
      }
      default:
        out.push({ text: part.value });
    }
  }
  return out;
}

/**
 * A date for display as base/reading segments, through the same
 * Intl.DateTimeFormat the plain formatter uses: en and ja are the one segment
 * format() speaks — identical to today's string — and ja-furigana runs
 * formatToParts and reads the kanji.
 */
export function formatDateRuby(
  date: Date | string,
  options: Intl.DateTimeFormatOptions,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): RubyText {
  const when = typeof date === "string" ? new Date(date) : date;
  const fmt = new Intl.DateTimeFormat(lang === "en" ? "en-US" : "ja-JP", options);
  if (lang !== "ja-furigana") return [{ text: fmt.format(when) }];
  return rubyFromParts(fmt.formatToParts(when));
}

/** The parts behind a ja-JP date, for callers that assemble their own format. */
export function jaDateRuby(date: Date, options: Intl.DateTimeFormatOptions): RubyText {
  return rubyFromParts(new Intl.DateTimeFormat("ja-JP", options).formatToParts(date));
}
