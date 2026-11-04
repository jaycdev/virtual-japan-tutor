import type { StorySentence, StoryToken } from "@vjt/api-client";

/**
 * A sentence split into the pieces a reader draws in order: its tokens, and the
 * characters the tokeniser left out (punctuation, spaces) as plain gaps. Offsets
 * are codepoints, the same ones the server and `Array.from` agree on.
 */
export type SentenceSegment =
  | { kind: "token"; token: StoryToken; index: number }
  | { kind: "gap"; text: string; key: string };

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
