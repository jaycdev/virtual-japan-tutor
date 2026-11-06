// The string table and the pure translation layer (issue #125). These tests
// are the completeness gate: every entry has both columns, every kanji in the
// Japanese column carries a furigana reading, both columns agree on their
// {placeholders}, and translate() honours all three Interface Languages.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERFACE_LANGUAGE,
  interfaceLanguageOptions,
  isJapanese,
  parseInterfaceLanguage,
} from "./language.ts";
import { isKanji, parseRuby } from "./ruby.ts";
import { strings, type StringKey } from "./strings.ts";
import { translate, translatePlain } from "./translate.ts";

const KEYS = Object.keys(strings) as StringKey[];

const PLACEHOLDERS = /\{([A-Za-z0-9_]+)\}/g;
function placeholderNames(source: string): string[] {
  return [...source.matchAll(new RegExp(PLACEHOLDERS, "g"))].map((m) => m[1] as string).sort();
}

const KANA = /[\u3041-\u309F\u30A1-\u30FA々〆ー]/; // hiragana, katakana, iteration marks, long vowel

describe("the string table", () => {
  it("has a non-empty en and ja column for every entry", () => {
    for (const key of KEYS) {
      expect(strings[key].en.trim(), `${key} has no English text`).not.toBe("");
      expect(strings[key].ja.trim(), `${key} has no Japanese text`).not.toBe("");
    }
  });

  it("agrees on its {placeholders} in both columns", () => {
    for (const key of KEYS) {
      expect(placeholderNames(strings[key].ja), `${key} placeholder mismatch`).toEqual(
        placeholderNames(strings[key].en),
      );
    }
  });

  it("covers every kanji in the Japanese column with a reading", () => {
    for (const key of KEYS) {
      for (const segment of parseRuby(strings[key].ja)) {
        if (segment.ruby === undefined) {
          const uncovered = [...segment.text].filter(isKanji);
          expect(uncovered, `${key}: kanji without furigana: ${uncovered.join("")}`).toEqual([]);
        }
      }
    }
  });

  it("writes every reading in kana only", () => {
    for (const key of KEYS) {
      for (const segment of parseRuby(strings[key].ja)) {
        if (segment.ruby !== undefined) {
          expect(segment.ruby, `${key} has an empty reading`).not.toBe("");
          for (const ch of segment.ruby) {
            expect(KANA.test(ch), `${key}: reading ${segment.ruby} is not all kana`).toBe(true);
          }
        }
      }
    }
  });

  it("keeps its placeholders parseable: no 《 without its 》", () => {
    for (const key of KEYS) {
      const ja = strings[key].ja;
      expect(ja.split("《").length, `${key} has an unbalanced 《`).toBe(ja.split("》").length);
    }
  });

  it("puts every reading over a kanji base", () => {
    // A reading sits on the kanji run before it, so the character right
    // before 《 must be a kanji — unless an explicit ｜ base marker opened
    // the base earlier in the same run (issue #125 review S15).
    for (const key of KEYS) {
      const ja = strings[key].ja;
      const chars = Array.from(ja);
      for (let i = 0; i < chars.length; i += 1) {
        if (chars[i] !== "《") continue;
        const prev = chars[i - 1] ?? "";
        const runStart = ja.lastIndexOf("》", i - 1) + 1;
        const baseRun = ja.slice(runStart, i);
        expect(
          isKanji(prev) || baseRun.includes("｜"),
          `${key}: 《 sits after "${prev}" — the base before a reading must be kanji or open after ｜`,
        ).toBe(true);
      }
    }
  });

  it("keeps readings flat: no 《 inside a reading", () => {
    // A 《reading》 closed by a later 》 would otherwise swallow a nested
    // bracket pair (issue #125 review S15).
    for (const key of KEYS) {
      const ja = strings[key].ja;
      for (const m of ja.matchAll(/《([^》]*)》/g)) {
        expect(m[1], `${key}: malformed reading ${m[0]}`).not.toContain("《");
      }
      expect(ja, `${key} has a doubled 《`).not.toContain("《《");
    }
  });
});

describe("the Interface Language type", () => {
  it("defaults to English until an app chooses otherwise", () => {
    expect(DEFAULT_INTERFACE_LANGUAGE).toBe("en");
    expect(parseInterfaceLanguage("ja")).toBe("ja");
    expect(parseInterfaceLanguage("ja-furigana")).toBe("ja-furigana");
    expect(parseInterfaceLanguage("en")).toBe("en");
    expect(parseInterfaceLanguage("fr")).toBe("en");
    expect(parseInterfaceLanguage(undefined)).toBe("en");
  });

  it("offers the three options, each labelled in its own language", () => {
    expect(interfaceLanguageOptions).toEqual([
      { value: "en", label: "English" },
      { value: "ja", label: "日本語" },
      { value: "ja-furigana", label: "日本語（ふりがな）" },
    ]);
    expect(isJapanese("en")).toBe(false);
    expect(isJapanese("ja")).toBe(true);
    expect(isJapanese("ja-furigana")).toBe(true);
  });
});

describe("translate", () => {
  it("shows English exactly as the table wrote it, with no readings", () => {
    for (const key of KEYS) {
      const segments = translate("en", key);
      expect(segments.some((s) => s.ruby !== undefined), `${key} leaked furigana into en`).toBe(false);
      expect(segments.map((s) => s.text).join("")).toBe(strings[key].en);
    }
  });

  it("reads plain Japanese with the furigana dropped", () => {
    expect(translate("ja", "greeting.morning")).toEqual([{ text: "おはようございます" }]);
    expect(translatePlain("ja", "greeting.morning")).toBe("おはようございます");
    expect(translatePlain("ja", "errors.not_found")).toBe("見つかりませんでした");
  });

  it("keeps the readings as segments for a furigana UI", () => {
    // The furigana base is the kanji run before the reading: the okurigana
    // つかりませんでした stands on its own, exactly as in printed Japanese.
    expect(translate("ja-furigana", "errors.not_found")).toEqual([
      { text: "見", ruby: "み" },
      { text: "つかりませんでした" },
    ]);
    // The base sentence of every entry is the same in ja and ja-furigana.
    for (const key of KEYS) {
      expect(translate("ja-furigana", key).map((s) => s.text).join("")).toBe(translatePlain("ja", key));
    }
  });

  it("fills {placeholders} in every language", () => {
    expect(translatePlain("en", "stage.writingAttempt", { attempt: 2, max: 3 })).toBe("Writing… attempt 2 of 3");
    expect(translatePlain("ja", "stage.writingAttempt", { attempt: 2, max: 3 })).toBe("作成中… 2回目（全3回）");
    expect(translatePlain("ja-furigana", "stage.writingAttempt", { attempt: 2, max: 3 })).toBe("作成中… 2回目（全3回）");
    expect(translatePlain("en", "errors.failedStatus", { status: 503 })).toBe("Request failed (503)");
    expect(translatePlain("ja", "errors.failedStatus", { status: 503 })).toBe("リクエストに失敗しました（503）");
  });

  it("never parses a parameter value for furigana", () => {
    // A Learner-typed name carrying the notation's own marks is shown as typed.
    const segments = translate("ja", "reader.menu.saveToTarget", { list: "語《ご》" });
    expect(segments.map((s) => s.text).join("")).toBe("語《ご》に保存");
    expect(segments.some((s) => s.ruby === "ご")).toBe(false);
  });

  it("splices a RubyText parameter in, readings kept only in furigana", () => {
    // Round-4 review A3: the {date} of the still-unread line is the
    // stillUnreadFromRuby segments, not bare text.
    expect(translatePlain("en", "today.storyStillUnread", { date: [{ text: "Monday" }] })).toBe(
      "Still unread from Monday.",
    );
    expect(translatePlain("ja", "today.storyStillUnread", { date: [{ text: "月曜日", ruby: "げつようび" }] })).toBe(
      "月曜日の読んでいない物語があります。",
    );
    const furiganaSegments = translate("ja-furigana", "today.storyStillUnread", {
      date: [{ text: "月曜日", ruby: "げつようび" }],
    });
    // The spliced weekday sits first, reading and all, and the base sentence
    // around it is the plain ja one.
    expect(furiganaSegments[0]).toEqual({ text: "月曜日", ruby: "げつようび" });
    expect(furiganaSegments.map((s) => s.text).join("")).toBe("月曜日の読んでいない物語があります。");
    // A multi-segment param (a whole date) joins into the surrounding text.
    const date = [{ text: "11" }, { text: "月", ruby: "がつ" }, { text: "4日", ruby: "よっか" }];
    expect(translatePlain("ja", "today.syncSucceededLine", { time: date })).toBe("最終同期は11月4日に完了しました。");
    const furigana = translate("ja-furigana", "today.syncSucceededLine", { time: date });
    expect(furigana.some((s) => s.text === "4日" && s.ruby === "よっか")).toBe(true);
    // The param array itself is never mutated by the splice.
    expect(date[0]).toEqual({ text: "11" });
  });

  it("leaves a placeholder visible when its value is missing", () => {
    expect(translatePlain("en", "errors.failedStatus", {})).toBe("Request failed ({status})");
  });
});

describe("the table's English column", () => {
  it("says the sentences today's tests pin, byte for byte", () => {
    expect(strings["errors.unreachable"].en).toBe("Cannot reach the server");
    expect(strings["errors.failed"].en).toBe("Request failed");
    expect(strings["story.startFailed"].en).toBe("Couldn't start writing a Story.");
    expect(strings["story.runFailed"].en).toBe("Couldn’t write a Story for you.");
    expect(strings["greeting.morning"].en).toBe("Good morning");
    expect(strings["section.levelBlurb"].en).toBe("N5–N1 known grammar baseline");
    expect(strings["story.originOnDemand"].en).toBe("On demand");
    expect(strings["auth.tryAgainIn"].en).toBe("Too many attempts. Try again in {secs} seconds.");
  });
});
