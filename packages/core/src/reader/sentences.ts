import type { StorySentence, StoryToken } from "@vjt/api-client";

import type { PhraseMark } from "./marks.ts";

/**
 * A sentence split into the pieces a reader draws in order: its tokens, and the
 * characters the tokeniser left out (punctuation, spaces) as plain gaps. Offsets
 * are codepoints, the same ones the server and `Array.from` agree on.
 */
export type SentenceSegment =
  | { kind: "token"; token: StoryToken; index: number }
  | { kind: "gap"; text: string; key: string };

/** A token segment, as sentenceSegments produces it. */
export type TokenSegment = Extract<SentenceSegment, { kind: "token" }>;

/**
 * A segment as the web reader draws it: the same gaps and tokens, except that
 * the consecutive tokens of one Phrase underline (issue #97) are grouped into a
 * single run, so the run can carry one continuous underline.
 */
export type RunSegment = SentenceSegment | { kind: "run"; key: string; members: TokenSegment[] };

/**
 * Groups the phrase runs of a sentence (issue #97). A run starts at a token
 * with a phrase underline that is the first of its Phrase, or that follows a
 * segment with no phrase underline (a gap, a plain token, or a token a Grammar
 * Span claims), and it continues across each following underlined token of the
 * same Phrase. So a Grammar Span in the middle of a Phrase gives two runs.
 */
export function phraseRuns(segments: SentenceSegment[], marks: PhraseMark[]): RunSegment[] {
  const out: RunSegment[] = [];
  let open: Extract<RunSegment, { kind: "run" }> | null = null;
  for (const segment of segments) {
    const mark = segment.kind === "token" ? marks[segment.index] : undefined;
    if (segment.kind !== "token" || !mark?.underline) {
      open = null;
      out.push(segment);
      continue;
    }
    if (open === null || mark.first) {
      open = { kind: "run", key: `run-${segment.index}`, members: [] };
      out.push(open);
    }
    open.members.push(segment);
  }
  return out;
}

export function sentenceSegments(sentence: StorySentence): SentenceSegment[] {
  const chars = Array.from(sentence.ja);
  const out: SentenceSegment[] = [];
  let cursor = 0;
  sentence.tokens.forEach((token, index) => {
    if (token.start > cursor) {
      out.push({ kind: "gap", text: chars.slice(cursor, token.start).join(""), key: `gap-${index}` });
    }
    out.push({ kind: "token", token, index });
    cursor = Math.max(cursor, token.end);
  });
  if (cursor < chars.length) out.push({ kind: "gap", text: chars.slice(cursor).join(""), key: "gap-end" });
  return out;
}
