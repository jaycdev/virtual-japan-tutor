import { describe, expect, it } from "vitest";
import { isKanji, parseRuby, stripRuby } from "./ruby.ts";

describe("parseRuby", () => {
  it("puts a reading over the kanji run before the brackets", () => {
    expect(parseRuby("今日《きょう》はいい天気《てんき》です")).toEqual([
      { text: "今日", ruby: "きょう" },
      { text: "はいい" },
      { text: "天気", ruby: "てんき" },
      { text: "です" },
    ]);
  });

  it("keeps okurigana in the base line, outside the reading", () => {
    // 書《か》けませんでした: only the kanji 書 takes the ruby.
    expect(parseRuby("書《か》けませんでした")).toEqual([
      { text: "書", ruby: "か" },
      { text: "けませんでした" },
    ]);
  });

  it("takes everything after ｜ as the base, hiragana and all", () => {
    expect(parseRuby("馬｜見る《みる》")).toEqual([
      { text: "馬" },
      { text: "見る", ruby: "みる" },
    ]);
    expect(parseRuby("ここ｜から《カー》")).toEqual([
      { text: "ここ" },
      { text: "から", ruby: "カー" },
    ]);
  });

  it("treats an unclosed 《 as ordinary text", () => {
    expect(parseRuby("50%《きょう")).toEqual([{ text: "50%《きょう" }]);
  });

  it("keeps a reading with nothing markable before it as literal text", () => {
    expect(parseRuby("《きょう》")).toEqual([{ text: "《きょう》" }]);
    expect(parseRuby("る《る》")).toEqual([{ text: "る《る》" }]);
  });

  it("drops the ｜ marker even when no reading follows it", () => {
    expect(parseRuby("馬｜見る")).toEqual([{ text: "馬見る" }]);
  });

  it("reads the iteration mark with what it repeats: 人々《ひとびと》", () => {
    // 々 stands for the kanji before it, so the ruby covers the pair (issue #125 S14).
    expect(parseRuby("人々《ひとびと》がいた")).toEqual([
      { text: "人々", ruby: "ひとびと" },
      { text: "がいた" },
    ]);
  });

  it("keeps a bare iteration mark as ordinary text", () => {
    expect(parseRuby("々")).toEqual([{ text: "々" }]);
    // A reading set directly over a lone mark still attaches: the mark is a
    // markable base now.
    expect(parseRuby("々《しょう》")).toEqual([{ text: "々", ruby: "しょう" }]);
  });

  it("walks by code point, so astral kanji stay whole", () => {
    // 𠮟 is outside the BMP: a UTF-16 walk would split it in half and lose
    // the reading (issue #125 S14).
    expect(parseRuby("𠮟《しか》る")).toEqual([
      { text: "𠮟", ruby: "しか" },
      { text: "る" },
    ]);
  });
});

describe("stripRuby", () => {
  it("removes readings and marks, leaving the base sentence", () => {
    expect(stripRuby("今日《きょう》はいい天気《てんき》です")).toBe("今日はいい天気です");
    expect(stripRuby("書《か》けませんでした")).toBe("書けませんでした");
    expect(stripRuby("馬｜見る《みる》")).toBe("馬見る");
  });

  it("accepts already-parsed segments", () => {
    expect(stripRuby(parseRuby("物語《ものがたり》がありません"))).toBe("物語がありません");
  });

  it("round-trips: parsing then joining bases equals stripping", () => {
    for (const source of ["この語《ことば》は見《み》つかりませんでした", "サーバーに接続《せつぞく》できません", " plain "]) {
      const joined = parseRuby(source)
        .map((segment) => segment.text)
        .join("");
      expect(joined).toBe(stripRuby(source));
    }
  });
});

describe("isKanji", () => {
  it("marks Han ideographs and nothing else", () => {
    expect(isKanji("漢")).toBe(true);
    expect(isKanji("あ")).toBe(false);
    expect(isKanji("ア")).toBe(false);
    expect(isKanji("《")).toBe(false);
  });

  it("marks the iteration and closing marks, and astral kanji", () => {
    // 々〆〇 carry the reading of what they repeat; 𠮟 lives beyond the BMP
    // (issue #125 S14).
    expect(isKanji("々")).toBe(true);
    expect(isKanji("〆")).toBe(true);
    expect(isKanji("〇")).toBe(true);
    expect(isKanji("𠮟")).toBe(true);
  });
});
