// The sentences Settings sections show about a server answer, and the small
// rules behind form fields. Shared so web and mobile say the same thing —
// and, since issue #125, say it in the Learner's Interface Language. The
// sentences are string-table entries; data that came from the server (names,
// ids, statuses, error text) rides through as {placeholder} values in the
// Learner's own words only where we wrote them, never rewritten here.

import type { GrammarReviewItem, MaruMoriSyncRun } from "@vjt/api-client";
import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./i18n/language.ts";
import type { RubyText } from "./i18n/ruby.ts";
import { translate, translatePlain } from "./i18n/translate.ts";

/** Stitch RubyText pieces into one line: server data as plain segments, our
 *  connectives from the table. Adjacent unannotated pieces merge, so a plain
 *  language renders the row as exactly the string the plain helpers show. */
function joinRuby(parts: RubyText[]): RubyText {
  const out: RubyText = [];
  for (const part of parts) {
    for (const segment of part) {
      const last = out[out.length - 1];
      if (last && last.ruby === undefined && segment.ruby === undefined) last.text += segment.text;
      else out.push({ ...segment });
    }
  }
  return out;
}

/** The line under "Sync now": what the finished run found. */
export function syncOutcomeText(
  run: MaruMoriSyncRun,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return joinPlain(syncOutcomeRuby(run, lang));
}

/** The same line with readings kept, for a UI that can draw them (issue #125). */
export function syncOutcomeRuby(
  run: MaruMoriSyncRun,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): RubyText {
  if (run.status === "failed") {
    return translate(lang, "sync.failed", { error: run.error ?? translate(lang, "sync.unknownError") });
  }
  const counts = run.counts;
  if (!counts) return translate(lang, "sync.complete");
  return translate(lang, "sync.counts", {
    new: counts.new,
    levelChanges: counts.levelChanges,
    disappeared: counts.disappeared,
  });
}

/** One row of the recent Syncs list. */
export function syncRunText(
  run: MaruMoriSyncRun,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return joinPlain(syncRunRuby(run, lang));
}

/** The same row with readings kept on our connective words (issue #125). */
export function syncRunRuby(
  run: MaruMoriSyncRun,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): RubyText {
  // startedAt and status are the server's own data: shown as they are, the
  // row's connective words are ours.
  return joinRuby([
    [{ text: `${run.startedAt} — ${run.status}` + (run.error ? ` — ${run.error}` : "") }],
    run.counts
      ? [
          { text: " — " },
          ...translate(lang, "sync.runCounts", { kanji: run.counts.kanji, vocabulary: run.counts.vocabulary }),
        ]
      : [],
  ]);
}

/** One row of the read-only "Review these grammar matches" list (issue #6). */
export function grammarReviewText(
  item: GrammarReviewItem,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return joinPlain(grammarReviewRuby(item, lang));
}

/** The same row with readings kept on our connective words (issue #125); the
 *  Pattern itself is Learner-catalogue content and rides through unannotated. */
export function grammarReviewRuby(
  item: GrammarReviewItem,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): RubyText {
  return joinRuby([grammarReviewPatternRuby(item), grammarReviewTailRuby(item, lang)]);
}

/** The row's leading Pattern, as the plain text it always is. The phone draws
 *  it under its own testID so its furigana check can exempt just this piece
 *  (#125 review). */
export function grammarReviewPatternRuby(item: GrammarReviewItem): RubyText {
  return [{ text: item.pattern || item.marumoriId }];
}

/** The rest of the row — level and match notes, our connectives, annotated in
 *  ja-furigana. */
export function grammarReviewTailRuby(
  item: GrammarReviewItem,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): RubyText {
  return joinRuby([
    item.jlptLevel ? [{ text: " " }, ...translate(lang, "grammarReview.level", { level: item.jlptLevel })] : [],
    item.matchedPointId
      ? [{ text: " " }, ...translate(lang, "grammarReview.matched", { point: item.matchedPointId })]
      : [{ text: " " }, ...translate(lang, "grammarReview.noMatch")],
  ]);
}

/** The result line after a Starting Level change: the Seeded Grammar counts. */
export function grammarUpdatedText(
  counts: { added?: number; removed?: number },
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return joinPlain(grammarUpdatedRuby(counts, lang));
}

/** The same line with readings kept, for a UI that can draw them (issue #125). */
export function grammarUpdatedRuby(
  counts: { added?: number; removed?: number },
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): RubyText {
  return translate(lang, "grammar.updated", { added: counts.added ?? 0, removed: counts.removed ?? 0 });
}

/** Segments joined to the plain string they draw outside ja-furigana. */
function joinPlain(segments: RubyText): string {
  let out = "";
  for (const segment of segments) out += segment.text;
  return out;
}

/** The Lookup hold field's rule: a whole number of milliseconds from 0 to 10000. */
export function parseLookupHold(
  text: string,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): { ok: true; ms: number } | { ok: false; message: string } {
  const message = translatePlain(lang, "settings.lookupHoldRule");
  if (text.trim() === "") return { ok: false, message };
  const ms = Number(text);
  if (!Number.isInteger(ms) || ms < 0 || ms > 10000) return { ok: false, message };
  return { ok: true, ms };
}

/** The Furigana Threshold choices (SRS levels), in picker order. */
export const FURIGANA_LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

/**
 * Suggestions for a free-text field (genre, theme, timezone): typed text filters
 * the list, and an empty field shows it only once the field has been focused.
 * The list is a convenience, not a whitelist. Shows at most `limit` entries.
 */
export function suggestionsFor(
  options: readonly string[],
  value: string,
  focused: boolean,
  limit = 8,
): { show: boolean; visible: string[] } {
  const query = value.trim().toLowerCase();
  const matches = options.filter((option) => query === "" || option.toLowerCase().includes(query));
  const visible = matches.slice(0, limit);
  return { show: (query !== "" || focused) && visible.length > 0, visible };
}
