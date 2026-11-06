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
    expect(translate("ja", "greeting.morning")).toEqual([{ text: "お早うございます" }]);
    expect(translatePlain("ja", "greeting.morning")).toBe("お早うございます");
    expect(translatePlain("ja", "errors.not_found")).toBe("見つかりませんでした");
  });

  it("keeps the readings as segments for a furigana UI", () => {
    // The furigana base is the kanji run before the reading: the kana お and
    // うございます stand on their own, exactly as in printed Japanese.
    expect(translate("ja-furigana", "greeting.morning")).toEqual([
      { text: "お" },
      { text: "早", ruby: "はや" },
      { text: "うございます" },
    ]);
    // The base sentence of every entry is the same in ja and ja-furigana.
    for (const key of KEYS) {
      expect(translate("ja-furigana", key).map((s) => s.text).join("")).toBe(translatePlain("ja", key));
    }
  });

  it("fills {placeholders} in every language", () => {
    expect(translatePlain("en", "stage.writingAttempt", { attempt: 2, max: 3 })).toBe("Writing… attempt 2 of 3");
    expect(translatePlain("ja", "stage.writingAttempt", { attempt: 2, max: 3 })).toBe("作成中… 2/3回目");
    expect(translatePlain("ja-furigana", "stage.writingAttempt", { attempt: 2, max: 3 })).toBe("作成中… 2/3回目");
    expect(translatePlain("en", "errors.failedStatus", { status: 503 })).toBe("Request failed (503)");
    expect(translatePlain("ja", "errors.failedStatus", { status: 503 })).toBe("リクエストに失敗しました（503）");
  });

  it("never parses a parameter value for furigana", () => {
    // A Learner-typed name carrying the notation's own marks is shown as typed.
    const segments = translate("ja", "reader.menu.saveToTarget", { list: "語《ご》" });
    expect(segments.map((s) => s.text).join("")).toBe("語《ご》に保存");
    expect(segments.some((s) => s.ruby === "ご")).toBe(false);
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
    expect(strings["story.runFailed"].en).toBe("Couldn't write a Story for you.");
    expect(strings["greeting.morning"].en).toBe("Good morning");
    expect(strings["section.levelBlurb"].en).toBe("N5–N1 known grammar baseline");
    expect(strings["story.originOnDemand"].en).toBe("On demand");
    expect(strings["auth.tryAgainIn"].en).toBe("Too many attempts. Try again in {secs} seconds.");
  });
});
