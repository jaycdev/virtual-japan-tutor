// The sentences Settings sections show about a server answer, and the small
// rules behind form fields. Shared so web and mobile say the same thing —
// and, since issue #125, say it in the Learner's Interface Language. The
// sentences are string-table entries; data that came from the server (names,
// ids, statuses, error text) rides through as {placeholder} values in the
// Learner's own words only where we wrote them, never rewritten here.

import type { GrammarReviewItem, MaruMoriSyncRun } from "@vjt/api-client";
import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./i18n/language.ts";
import { translatePlain } from "./i18n/translate.ts";

/** The line under "Sync now": what the finished run found. */
export function syncOutcomeText(
  run: MaruMoriSyncRun,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  if (run.status === "failed") {
    return translatePlain(lang, "sync.failed", { error: run.error ?? translatePlain(lang, "sync.unknownError") });
  }
  const counts = run.counts;
  if (!counts) return translatePlain(lang, "sync.complete");
  return translatePlain(lang, "sync.counts", {
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
  // startedAt and status are the server's own data: shown as they are, the
  // row's connective words are ours.
  return (
    `${run.startedAt} — ${run.status}` +
    (run.error ? ` — ${run.error}` : "") +
    (run.counts
      ? ` — ${translatePlain(lang, "sync.runCounts", { kanji: run.counts.kanji, vocabulary: run.counts.vocabulary })}`
      : "")
  );
}

/** One row of the read-only "Review these grammar matches" list (issue #6). */
export function grammarReviewText(
  item: GrammarReviewItem,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return (
    `${item.pattern || item.marumoriId}` +
    (item.jlptLevel ? ` ${translatePlain(lang, "grammarReview.level", { level: item.jlptLevel })}` : "") +
    (item.matchedPointId
      ? ` ${translatePlain(lang, "grammarReview.matched", { point: item.matchedPointId })}`
      : ` ${translatePlain(lang, "grammarReview.noMatch")}`)
  );
}

/** The result line after a Starting Level change: the Seeded Grammar counts. */
export function grammarUpdatedText(
  counts: { added?: number; removed?: number },
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return translatePlain(lang, "grammar.updated", { added: counts.added ?? 0, removed: counts.removed ?? 0 });
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
