// Pure helpers for the Grammar screens: how the catalogue is grouped, how a
// Grammar Point's source reads, how the server's light Markdown explanation is
// split into blocks, and where the catalogue was left so Back can return to it.
// No React here, so the rules are tested without a DOM.
import type { GrammarJLPTLevel, GrammarPointSummary } from "@vjt/api-client";

/** How long a typed search term settles before the catalogue re-reads (ui-plan 4.6). */
export const SEARCH_DEBOUNCE_MS = 300;

/** The plan's ordering of level groups, easiest first. */
export const LEVEL_ORDER: GrammarJLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

export type GrammarKnowledge = "seeded" | "observed";

/**
 * Where a point came from, as the plan words it: Seeded (the Starting Level) or
 * Observed (the Learner's MaruMori activity). The catalogue list does not carry
 * this yet (API follow-up #65), so a summary without `source` is "not recorded"
 * rather than a guess. The optional field is read here so the badge lights up as
 * soon as the server sends it, with no change to this screen.
 */
export function knowledgeOf(point: GrammarPointSummary): GrammarKnowledge | undefined {
  const source = (point as { source?: unknown }).source;
  if (source === "seeded") return "seeded";
  if (source === "observed" || source === "marumori") return "observed";
  return undefined;
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

/** "1 example" / "3 examples". */
export function exampleCountLabel(count: number): string {
  return `${count} example${count === 1 ? "" : "s"}`;
}

/** One block of an explanation: a paragraph, or a run of "- " bullets. */
export type ExplanationBlock = { type: "paragraph"; text: string } | { type: "list"; items: string[] };

/**
 * Split the server's explanation (light Markdown: paragraphs, "- " bullets, and
 * **bold** inside a line, generate.go's prompt) into blocks. Nothing here turns
 * the text into HTML: the caller renders each piece as a React text node.
 */
export function parseExplanation(text: string): ExplanationBlock[] {
  const blocks: ExplanationBlock[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    for (const raw of paragraph.split("\n")) {
      const line = raw.trim();
      if (line === "") continue;
      if (line.startsWith("- ")) {
        const item = line.slice(2).trim();
        const last = blocks.at(-1);
        if (last?.type === "list") last.items.push(item);
        else blocks.push({ type: "list", items: [item] });
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
 * Where the Learner had got to in the catalogue: the page offset and the window
 * scroll, keyed by the history entry they left from. Storing it under the entry
 * key (not module state) means Back restores it, a fresh visit from the sidebar
 * does not, and a StrictMode double mount reads the same answer twice.
 */
export interface BrowseSnapshot {
  key: string;
  offset: number;
  scrollY: number;
}

const BROWSE_STORAGE_KEY = "vjt.grammar.browse";

export function saveBrowse(snapshot: BrowseSnapshot): void {
  try {
    window.sessionStorage.setItem(BROWSE_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable (private mode, quota); Back then opens page one.
  }
}

export function readBrowse(key: string): { offset: number; scrollY: number } | null {
  try {
    const raw = window.sessionStorage.getItem(BROWSE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BrowseSnapshot>;
    if (parsed.key !== key || typeof parsed.offset !== "number" || typeof parsed.scrollY !== "number") return null;
    return { offset: Math.max(0, parsed.offset), scrollY: Math.max(0, parsed.scrollY) };
  } catch {
    return null;
  }
}
