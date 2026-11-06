/**
 * The furigana notation the Japanese string table uses, in the Aozora Bunko
 * style: 今日《きょう》 puts きょう over the kanji run before the brackets,
 * and an explicit base marker — 馬｜見る《みる》 — makes the base everything
 * after the marker, hiragana and all. The table itself stays a plain string,
 * so entries read naturally in a diff; this module is the only thing that
 * understands the marks.
 */

export interface RubySegment {
  /** The characters shown in the base line, marks removed. */
  text: string;
  /** The reading shown above the base, absent when there is none. */
  ruby?: string;
}

/** One string's worth of base-and-reading segments. */
export type RubyText = RubySegment[];

const OPEN = "《";
const CLOSE = "》";
const BASE_MARK = "｜";

/** Hanzi — the characters a reading may sit over. */
export function isKanji(ch: string): boolean {
  return /[㐀-䶿一-鿿豈-﫿]/u.test(ch);
}

/**
 * Split a marked string into segments. The base of a 《reading》 is the run of
 * kanji just before it; after a ｜ marker the base is instead everything since
 * the marker. A 《 with no closing 》 is ordinary text, and a 《reading》 with
 * nothing markable before it is kept as literal text, brackets and all.
 */
export function parseRuby(source: string): RubySegment[] {
  const segments: RubySegment[] = [];
  let pending = "";
  let baseFrom = -1; // set by ｜: the base must start here, kanji run or not

  const emit = (text: string, ruby?: string) => {
    if (text === "") return;
    const last = segments[segments.length - 1];
    if (ruby === undefined && last && last.ruby === undefined) last.text += text;
    else segments.push(ruby === undefined ? { text } : { text, ruby });
  };

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === BASE_MARK) {
      baseFrom = pending.length;
      continue;
    }
    if (ch === OPEN) {
      const close = source.indexOf(CLOSE, i + 1);
      if (close !== -1) {
        const reading = source.slice(i + 1, close);
        let baseStart = baseFrom;
        if (baseStart < 0) {
          // No explicit base: the kanji run ending at the brackets.
          let j = pending.length;
          while (j > 0 && isKanji(pending.charAt(j - 1))) j -= 1;
          baseStart = j;
        }
        const base = pending.slice(baseStart);
        if (base === "") {
          // Nothing markable before the brackets: ordinary text, kept as typed.
          pending += source.slice(i, close + 1);
          i = close;
          continue;
        }
        emit(pending.slice(0, baseStart));
        emit(base, reading);
        pending = "";
        baseFrom = -1;
        i = close;
        continue;
      }
    }
    pending += ch;
  }
  emit(pending);
  return segments;
}

/**
 * The sentence with every reading (and every mark) dropped — what a plain
 * `string` UI shows, and what the furigana-coverage test reads back. Accepts
 * either the marked source or already-parsed segments.
 */
export function stripRuby(source: string | RubyText): string {
  if (typeof source !== "string") return source.map((segment) => segment.text).join("");
  let out = "";
  for (const segment of parseRuby(source)) out += segment.text;
  return out;
}
