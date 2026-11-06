// Reading a string table entry in one Interface Language: the entry's {name}
// placeholders filled, its furigana kept or dropped per language. Pure — the
// React glue in context.ts is the only part that knows about components.

import type { InterfaceLanguage } from "./language.ts";
import { parseRuby, type RubySegment, type RubyText } from "./ruby.ts";
import { strings, type StringKey } from "./strings.ts";

/** Values substituted for {placeholders}. Numbers are accepted where counts show. */
export type TranslateParams = Record<string, string | number>;

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
 * that can render ruby. Parameter values are inserted as plain text and never
 * parsed for furigana — a name typed by the Learner is shown as typed.
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
    push({ text: value === undefined ? match[0] : String(value) });
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
