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
 *
 * A Phrase's key has an empty reading: that empty reading is what keys the
 * phrase's Lookup in the cache (useEntryLookup), so every token of the phrase
 * loads and peeks the same entry.
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

/** The two Dictionary rows a Lookup Menu can carry: the word's own, and its Phrase's (issue #97). */
export type DictionaryRow = "dictionary" | "phraseDictionary";

/**
 * The Dictionary Entry one Dictionary row opens (issue #97). The Phrase row opens
 * the Phrase's entry, when a Phrase covers the word and no Grammar Span does. The
 * word's own row opens the word's own entry whenever it has one, even inside a
 * Phrase, so the word stays reachable from the menu; a word with no entry of its
 * own falls back to the Phrase, as lookupKey does.
 */
export function dictionaryKey(
  sentence: StorySentence,
  token: StoryToken,
  span: StoryGrammarSpan | null,
  row: DictionaryRow,
): LookupKey | null {
  if (row === "phraseDictionary") {
    if (span !== null) return null;
    const phrase = coveringPhrase(sentence, token);
    return phrase ? { entSeq: phrase.entSeq, surface: phraseText(sentence, phrase), reading: "" } : null;
  }
  if (token.entSeq !== undefined) return { entSeq: token.entSeq, surface: token.surface, reading: token.reading };
  return lookupKey(sentence, token, span);
}

/**
 * Every Dictionary Entry a word's menu can open, the word's own first, so a press
 * primes both rows (issue #97). A word with no entry of its own in a Phrase has
 * just the Phrase's.
 */
export function dictionaryKeys(
  sentence: StorySentence,
  token: StoryToken,
  span: StoryGrammarSpan | null,
): LookupKey[] {
  const keys: LookupKey[] = [];
  for (const row of ["dictionary", "phraseDictionary"] as const) {
    const key = dictionaryKey(sentence, token, span, row);
    if (key && !keys.some((k) => k.entSeq === key.entSeq && k.surface === key.surface && (k.reading ?? "") === (key.reading ?? ""))) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The phrase-wide underline one token carries (issue #97). `first` and `last`
 * mark the ends of the run of tokens the underline spans, so a renderer can
 * join the run across them.
 */
export interface PhraseMark {
  underline: boolean;
  first: boolean;
  last: boolean;
}

const NO_PHRASE_MARK: PhraseMark = { underline: false, first: false, last: false };

/**
 * The phrase underline for a token (issue #97). A token inside a Phrase gets
 * one continuous underline across every token of that Phrase, Known ones
 * included, as long as the Phrase has at least one non-Known token; a Phrase
 * whose tokens are all Known gets none. A token under a Grammar Span keeps its
 * Grammar Span marking, so it gets no phrase underline, and it is left out of
 * the run (the Grammar Span has the precedence the Lookup does too).
 */
export function phraseMarkFor(
  sentence: StorySentence,
  token: StoryToken,
  span: StoryGrammarSpan | null,
): PhraseMark {
  if (span !== null) return NO_PHRASE_MARK;
  // A sentence with no phrases list (an older payload) has no phrase marks.
  if (!sentence.phrases?.length) return NO_PHRASE_MARK;
  const phrase = coveringPhrase(sentence, token);
  if (!phrase) return NO_PHRASE_MARK;
  // The run: the Phrase's tokens that no Grammar Span claims, in sentence order.
  const run = sentence.tokens.filter(
    (t) => phrasesCovering(t, [phrase]).length > 0 && spansCovering(t, sentence.grammarSpans).length === 0,
  );
  if (!run.some((t) => t.tag !== "known")) return NO_PHRASE_MARK;
  const at = run.findIndex((t) => t.start === token.start && t.end === token.end);
  if (at < 0) return NO_PHRASE_MARK;
  return { underline: true, first: at === 0, last: at === run.length - 1 };
}

/**
 * The phrase mark of every token of a sentence, in token order (issue #97). The
 * reader computes this once per sentence and indexes it per token, instead of
 * working out the run again for each word it draws.
 */
export function sentencePhraseMarks(sentence: StorySentence): PhraseMark[] {
  return sentence.tokens.map((token) =>
    phraseMarkFor(sentence, token, spansCovering(token, sentence.grammarSpans)[0] ?? null),
  );
}

/**
 * Whether a word's Lookup and Dictionary action open its Phrase's entry rather
 * than its own: a Phrase covers the word and no Grammar Span does (issue #97).
 */
export function opensPhraseEntry(sentence: StorySentence, token: StoryToken, span: StoryGrammarSpan | null): boolean {
  return span === null && coveringPhrase(sentence, token) !== null;
}

/**
 * The marks for a token with its phrase underline applied: the phrase run is one
 * underline in the lookup colour, so it replaces the token's own lookup underline.
 * A Focus underline stays, since it is a different meaning. The highlighter is
 * untouched.
 */
export function withPhraseMark(marks: TokenMarks, phrase: PhraseMark): TokenMarks {
  if (!phrase.underline || marks.underline === "focus") return marks;
  return { ...marks, underline: "lookup" };
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
