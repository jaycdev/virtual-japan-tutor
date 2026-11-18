import type { StoryGrammarSpan, StoryPhrase, StorySentence, StoryToken } from "@vjt/api-client";

/**
 * Token-to-mark classification for the Story reader (issue #77, shared by the
 * phone and the web reader). This decides WHICH mark a word carries and what
 * that mark means; each app maps the result to its own styling (Uniwind classes
 * on mobile, Tailwind and CSS on web), so both show the same meaning:
 *
 *   Known Item                   → no mark at all
 *   linked, not known           → dotted underline (`lookup`)
 *   Focus Set vocabulary        → the same underline in the Focus colour (`focus`)
 *   inside a Grammar Span       → highlighter (`grammar`), stronger for a Focus Span
 */

/** Whether the word gets the lookup underline: linked, and not a Known Item. */
export function isLookupMarked(token: StoryToken): boolean {
  return token.entSeq !== undefined && token.tag !== "known";
}

/** The highlighter a word sits under, if any. */
export type GrammarMark = "none" | "grammar" | "grammarFocus";

/** The underline a word carries: none, the lookup colour, or the Focus colour. */
export type WordUnderline = "none" | "lookup" | "focus";

export interface TokenMarks {
  grammar: GrammarMark;
  underline: WordUnderline;
}

/** The Grammar Spans covering a token (codepoint ranges overlap). */
export function spansCovering(token: StoryToken, spans: StoryGrammarSpan[]): StoryGrammarSpan[] {
  return spans.filter((sp) => token.start < sp.end && sp.start < token.end);
}

/**
 * The Phrases covering a token (codepoint ranges overlap). A Phrase is a
 * compound word such as この頃 (issue #97): hovering any of its tokens shows one
 * Lookup for the phrase, while each token keeps its own menu.
 */
export function phrasesCovering(token: StoryToken, phrases: StoryPhrase[]): StoryPhrase[] {
  return phrases.filter((p) => token.start < p.end && p.start < token.end);
}

/** The first Phrase covering this token, or null (codepoint offsets). */
export function coveringPhrase(sentence: StorySentence, token: StoryToken): StoryPhrase | null {
  return phrasesCovering(token, sentence.phrases)[0] ?? null;
}

/** The Japanese a Phrase covers in its sentence (codepoints, as the offsets count them). */
export function phraseText(sentence: StorySentence, phrase: StoryPhrase): string {
  return Array.from(sentence.ja).slice(phrase.start, phrase.end).join("");
}

/** What a word's Lookup loads: the Dictionary Entry it names and the text to show for it. */
export interface LookupKey {
  entSeq: number;
  surface: string;
  reading?: string;
}

/**
 * The Lookup key for a word (issue #97). A Phrase covering the word wins over
 * the word's own entry, but only when no Grammar Span covers the word: the
 * Grammar Span keeps its Lookup, as before. Null when there is nothing to look up.
 */
export function lookupKey(
  sentence: StorySentence,
  token: StoryToken,
  span: StoryGrammarSpan | null,
): LookupKey | null {
  if (span === null) {
    const phrase = coveringPhrase(sentence, token);
    if (phrase) return { entSeq: phrase.entSeq, surface: phraseText(sentence, phrase), reading: "" };
  }
  if (token.entSeq !== undefined) return { entSeq: token.entSeq, surface: token.surface, reading: token.reading };
  return null;
}

/**
 * The marks for one token. `focusEntSeqs` is the Focus Set vocabulary of the
 * open Story (the `isFocus` vocab items); a word in it takes the Focus underline
 * when it would otherwise carry the lookup one.
 */
export function tokenMarks(
  token: StoryToken,
  spans: StoryGrammarSpan[],
  focusEntSeqs: ReadonlySet<number> = new Set(),
): TokenMarks {
  const covered = spansCovering(token, spans);
  let grammar: GrammarMark = "none";
  if (covered.length > 0) grammar = covered.some((sp) => sp.isFocus) ? "grammarFocus" : "grammar";
  let underline: WordUnderline = "none";
  if (isLookupMarked(token)) {
    underline = token.entSeq !== undefined && focusEntSeqs.has(token.entSeq) ? "focus" : "lookup";
  }
  return { grammar, underline };
}
