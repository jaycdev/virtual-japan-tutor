// The sentences Settings sections show about a server answer, and the small
// rules behind form fields. Shared so web and mobile say the same thing.

import type { GrammarReviewItem, MaruMoriSyncRun } from "@vjt/api-client";

/** The line under "Sync now": what the finished run found. */
export function syncOutcomeText(run: MaruMoriSyncRun): string {
  if (run.status === "failed") return `Sync failed: ${run.error ?? "unknown error"}`;
  const counts = run.counts;
  if (!counts) return "Sync complete";
  return `Sync complete — ${counts.new} new Known Items, ${counts.levelChanges} level changes, ${counts.disappeared} disappeared`;
}

/** One row of the recent Syncs list. */
export function syncRunText(run: MaruMoriSyncRun): string {
  return (
    `${run.startedAt} — ${run.status}` +
    (run.error ? ` — ${run.error}` : "") +
    (run.counts ? ` — ${run.counts.kanji} kanji, ${run.counts.vocabulary} vocabulary` : "")
  );
}

/** One row of the read-only "Review these grammar matches" list (issue #6). */
export function grammarReviewText(item: GrammarReviewItem): string {
  return (
    `${item.pattern || item.marumoriId}` +
    (item.jlptLevel ? ` (MaruMori level ${item.jlptLevel})` : "") +
    (item.matchedPointId
      ? ` — matched point ${item.matchedPointId}, level was ambiguous`
      : " — no Grammar Catalogue match")
  );
}

/** The result line after a Starting Level change: the Seeded Grammar counts. */
export function grammarUpdatedText(counts: { added?: number; removed?: number }): string {
  return `Grammar updated: ${counts.added ?? 0} added, ${counts.removed ?? 0} removed.`;
}

/** The Lookup hold field's rule: a whole number of milliseconds from 0 to 10000. */
export function parseLookupHold(text: string): { ok: true; ms: number } | { ok: false; message: string } {
  const message = "The hold is a whole number of milliseconds from 0 to 10000.";
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
