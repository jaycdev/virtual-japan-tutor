// Reading a string table entry in one Interface Language: the entry's {name}
// placeholders filled, its furigana kept or dropped per language. Pure — the
// React glue in context.ts is the only part that knows about components.

import type { InterfaceLanguage } from "./language.ts";
import { parseRuby, type RubySegment, type RubyText } from "./ruby.ts";
import { strings, type StringKey } from "./strings.ts";

/**
 * Values substituted for {placeholders}. Numbers are accepted where counts show,
 * and RubyText (the date formatters' segments) where the param is itself
 * interface text with readings — see translate() for how it splices in.
 */
export type TranslateParams = Record<string, string | number | RubyText>;

/**
 * A string-table entry kept unresolved — key plus params — so a UI can hold it
 * in state and draw it through the Interface Language whenever it renders;
 * resolving it at the moment of failure would freeze that moment's language.
 */
export type EntryRef = { k: StringKey; params?: TranslateParams };

/**
 * The English plural "s" passed as a translation param: Japanese counts carry no
 * ending, so the param exists only to keep English wording byte-identical.
 */
export function pluralEn(language: InterfaceLanguage, count: number): "s" | "" {
  return language === "en" && count !== 1 ? "s" : "";
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/**
 * The entry in `lang`, as base/reading segments: `en` has no readings at all,
 * `ja` parses the notation and drops it, and `ja-furigana` keeps it for a UI
 * that can render ruby. Plain parameter values are inserted as text and never
 * parsed for furigana — a name typed by the Learner is shown as typed. A
 * RubyText parameter (dates and other interface text with
 * their own readings) splices its segments in: readings kept in ja-furigana,
 * joined to their base text in en and ja.
 */
export function translate(
  lang: InterfaceLanguage,
  key: StringKey,
  params?: TranslateParams,
): RubyText {
  const source = lang === "en" ? strings[key].en : strings[key].ja;
  const segments: RubySegment[] = [];
  const push = (segment: RubySegment) => {
    const last = segments[segments.length - 1];
    if (last && last.ruby === undefined && segment.ruby === undefined) last.text += segment.text;
    else segments.push(segment);
  };

  let cursor = 0;
  PLACEHOLDER.lastIndex = 0;
  let match: RegExpExecArray | null;
  const literal = (text: string) => {
    if (text === "") return;
    for (const segment of parseRuby(text)) {
      if (segment.ruby !== undefined && lang !== "ja-furigana") {
        push({ text: segment.text });
      } else {
        push(segment);
      }
    }
  };
  while ((match = PLACEHOLDER.exec(source)) !== null) {
    literal(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const value = params?.[match[1] ?? ""];
    if (Array.isArray(value)) {
      // A RubyText param: copies of the caller's segments, readings dropped
      // outside ja-furigana. Copied so the caller's array can never be
      // mutated by the segment merge above.
      for (const segment of value) push(lang === "ja-furigana" ? { ...segment } : { text: segment.text });
    } else {
      push({ text: value === undefined ? match[0] : String(value) });
    }
  }
  literal(source.slice(cursor));
  return segments;
}

/** The entry as a plain string — furigana never reaches a `string` UI. */
export function translatePlain(lang: InterfaceLanguage, key: StringKey, params?: TranslateParams): string {
  let out = "";
  for (const segment of translate(lang, key, params)) out += segment.text;
  return out;
}
