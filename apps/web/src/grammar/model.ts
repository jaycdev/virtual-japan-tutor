// Pure helpers for the Grammar screens: how the catalogue is grouped and filtered,
// how a Grammar Point's status reads, how the server's light Markdown explanation
// is split into blocks, how example spans are clamped, and where the scroll
// position was left so Back can return to it. No React here, so the rules are
// tested without a DOM.
import type { GrammarJLPTLevel, GrammarPointSummary } from "@vjt/api-client";
import { translatePlain, pluralEn, type InterfaceLanguage } from "@vjt/core";

/** How long a typed search term settles before the catalogue re-reads (ui-plan 4.6). */
export const SEARCH_DEBOUNCE_MS = 300;

/** The page size the catalogue asks for (useGrammar's own page of 50). */
export const PAGE_SIZE = 50;

/** The plan's ordering of levels, easiest first. The index always lists all five. */
export const LEVEL_ORDER: GrammarJLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

/**
 * A Grammar Point's status as the web catalogue shows it. `undefined` is not a
 * status at all: the summary carries no `source` (the list API does not send it
 * yet, #65), so the screen shows nothing rather than a guess.
 */
export type GrammarStatus = "seeded" | "observed" | "notKnown";

/**
 * Where a point came from, as the plan words it: Seeded (the Starting Level) or
 * Observed (the Learner's MaruMori activity). Returns undefined while the summary
 * has no `source` field (API follow-up #65), so the status is hidden. Once the
 * server sends it, "seeded" reads as Seeded, "observed" and the sync's own
 * "marumori" read as Observed, and any other value reads as Not known. Nothing
 * else in the screen changes when the field lands.
 */
export function statusOf(point: GrammarPointSummary): GrammarStatus | undefined {
  // Read through a cast: the typed summary has no `source` until #65 adds it.
  const source = (point as { source?: unknown }).source;
  if (source === undefined) return undefined;
  if (source === "seeded") return "seeded";
  if (source === "observed" || source === "marumori") return "observed";
  return "notKnown";
}

/**
 * Group the page's points under their JLPT Level, easiest first. The server
 * already returns points in level and catalogue-number order, so each group
 * keeps that order. A level outside the known five lands after them.
 */
export function groupByLevel(items: GrammarPointSummary[]): { level: string; points: GrammarPointSummary[] }[] {
  const byLevel = new Map<string, GrammarPointSummary[]>();
  for (const point of items) {
    const group = byLevel.get(point.jlptLevel) ?? [];
    group.push(point);
    byLevel.set(point.jlptLevel, group);
  }
  const known = LEVEL_ORDER.filter((level) => byLevel.has(level)).map((level) => ({
    level: level as string,
    points: byLevel.get(level) as GrammarPointSummary[],
  }));
  const rest = [...byLevel.entries()]
    .filter(([level]) => !LEVEL_ORDER.includes(level as GrammarJLPTLevel))
    .map(([level, points]) => ({ level, points }));
  return [...known, ...rest];
}

/** A level the URL may name (`?level=`), or "all" for no level filter. Anything else is "all". */
export function parseLevel(raw: string | null): GrammarJLPTLevel | "all" {
  return LEVEL_ORDER.find((level) => level === raw) ?? "all";
}

/** A 1-based page from `?page=`. Anything that is not a positive whole number is page 1. */
export function parsePage(raw: string | null): number {
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

/** The catalogue offset for a 1-based page. */
export function offsetForPage(page: number): number {
  return (Math.max(1, page) - 1) * PAGE_SIZE;
}

/** "1 example" / "3 examples", in the Learner's Interface Language. */
export function exampleCountLabel(count: number, lang: InterfaceLanguage = "en"): string {
  return translatePlain(lang, "grammar.exampleCount", {
    count,
    plural: pluralEn(lang, count),
  });
}

/** One block of an explanation: a paragraph, or a run of bullets or numbered items. */
export type ExplanationBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

// The server asks for "short markdown: paragraphs, **bold** for the pattern,
// bullet lists" (apps/server/internal/grammar/generate.go). Models write bullets
// as "-", "*" or "•", and sometimes numbered items as "1." or "1)". Both
// expressions are anchored and bounded, so each line is matched in linear time.
const BULLET = /^[-*•]\s+/;
const NUMBERED = /^\d{1,3}[.)]\s+/;

/**
 * Split the server's explanation into blocks. Nothing here turns the text into
 * HTML: the caller renders each piece as a React text node. A run of bullets and
 * a run of numbered items become separate lists; a line between them ends a list.
 */
export function parseExplanation(text: string): ExplanationBlock[] {
  const blocks: ExplanationBlock[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    for (const raw of paragraph.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      const bullet = BULLET.exec(line);
      const numbered = bullet ? null : NUMBERED.exec(line);
      if (bullet || numbered) {
        const ordered = numbered !== null;
        const item = line.slice((bullet ?? numbered)?.[0].length ?? 0).trim();
        const last = blocks.at(-1);
        if (last?.type === "list" && last.ordered === ordered) last.items.push(item);
        else blocks.push({ type: "list", ordered, items: [item] });
      } else {
        blocks.push({ type: "paragraph", text: line });
      }
    }
  }
  return blocks;
}

/** A run of a line: plain text, or text the Markdown marked **bold**. */
export interface BoldRun {
  text: string;
  bold: boolean;
}

/** Split one line on ** markers into alternating plain and bold runs (empty runs dropped). */
export function boldRuns(line: string): BoldRun[] {
  return line
    .split("**")
    .map((text, i) => ({ text, bold: i % 2 === 1 }))
    .filter((run) => run.text !== "");
}

/**
 * The Grammar Span of an example, as rune offsets into the sentence, clamped to
 * the sentence. The data should always be in range; a bad offset must still not
 * break the page or mark text that is not there. `start` is clamped to
 * [0, n], and `end` to [start, n].
 */
export function clampSpan(spanStart: number, spanEnd: number, length: number): { start: number; end: number } {
  const start = Math.min(Math.max(0, Math.trunc(spanStart) || 0), length);
  const end = Math.min(Math.max(start, Math.trunc(spanEnd) || 0), length);
  return { start, end };
}

/**
 * Where the Learner's scroll position was left in the catalogue, keyed by the
 * history entry they left from. Storing it under the entry key means Back restores
 * it, a fresh visit from the sidebar does not, and a StrictMode double mount reads
 * the same answer twice. The search term, level and page are in the URL, not here.
 */
export interface BrowseSnapshot {
  key: string;
  scrollY: number;
}

const BROWSE_STORAGE_KEY = "vjt.grammar.browse";

export function saveBrowse(snapshot: BrowseSnapshot): void {
  try {
    window.sessionStorage.setItem(BROWSE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable (private mode, quota); Back then opens at the top.
  }
}

export function readBrowse(key: string): { scrollY: number } | null {
  try {
    const raw = window.sessionStorage.getItem(BROWSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowseSnapshot>;
    if (parsed.key !== key || typeof parsed.scrollY !== "number") return null;
    return { scrollY: Math.max(0, parsed.scrollY) };
  } catch {
    return null;
  }
}
