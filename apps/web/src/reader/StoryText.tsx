import type { Story, StorySentence, StoryToken } from "@vjt/api-client";
import { sentenceSegments, showsFurigana, spansCovering, tokenMarks, type TokenRef } from "@vjt/core";
import {
  Fragment,
  useEffect,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import { cn } from "@/lib/utils";
import type { StoryTextSize } from "../storysize/store.ts";
import { plainJapanese } from "./copy.ts";
import "./reader.css";

/**
 * The story column (ui-plan 4.1): Japanese in the serif, centred, about 40
 * characters wide at the saved Story text size. Every word is a token span:
 *
 *   - furigana is `<ruby>` over the surface, shown where the server's Furigana
 *     Threshold says so (showFurigana), so copies and screen readers get the base
 *     text;
 *   - marks are CSS: a dotted underline in `lookup-mark` (offset clear of the
 *     furigana above), the solid `focus` underline for Focus Set vocabulary,
 *     the `grammar` / `grammar-focus` highlighter for a Grammar Span, and the
 *     `selected-sentence` background on the chosen sentence;
 *   - a word with a Dictionary Entry, or inside a Grammar Span, is focusable
 *     (Tab reaches it) and opens the Lookup on hover or focus, and its menu on click
 *     or Enter.
 *
 * Text is only ever rendered as React text nodes. Story text, glosses and AI output
 * never go through an HTML string (issue #84 review).
 */

/** The mark-and-menu props a token needs from the reader. */
export interface StoryTextHandlers {
  onSelectSentence(sentence: number): void;
  onTokenEnter(ref: TokenRef): void;
  onTokenLeave(ref: TokenRef): void;
  onTokenFocus(ref: TokenRef): void;
  onTokenBlur(ref: TokenRef): void;
  /** A click or Enter on a word: open its Lookup Menu from the word's element. */
  onTokenActivate(ref: TokenRef, element: HTMLElement): void;
}

export interface StoryTextProps extends StoryTextHandlers {
  story: Story;
  selected: number | null;
  /** The Lookup Menu's word, if one is open (its token keeps the menu state). */
  menuToken: TokenRef | null;
  /** Vocabulary entSeqs of the Story's Focus Set. */
  focusEntSeqs: ReadonlySet<number>;
  size: StoryTextSize;
  columnRef: RefObject<HTMLDivElement | null>;
  /** The Lookup Menu's anchor, rendered inside the column so it scrolls with the words. */
  children?: ReactNode;
}

export function StoryText({
  story,
  selected,
  menuToken,
  focusEntSeqs,
  size,
  columnRef,
  children,
  ...handlers
}: StoryTextProps) {
  useCleanCopy(columnRef);
  return (
    <div
      ref={columnRef}
      data-testid="story-column"
      className="story-column-width story-text relative mx-auto font-serif text-foreground"
      style={{ fontSize: "var(--story-text-size)", lineHeight: "var(--story-line-height)" }}
    >
      {story.sentences.map((sentence, i) => (
        <p
          key={i}
          data-sentence={i}
          aria-label={`Sentence ${i + 1}`}
          onClick={() => handlers.onSelectSentence(i)}
          className={cn("mb-[0.6em] rounded-sm", selected === i && "bg-selected-sentence")}
        >
          {sentenceSegments(sentence).map((segment) =>
            segment.kind === "gap" ? (
              <Fragment key={segment.key}>{segment.text}</Fragment>
            ) : (
              <Word
                key={segment.index}
                sentenceIndex={i}
                index={segment.index}
                token={segment.token}
                sentence={sentence}
                focusEntSeqs={focusEntSeqs}
                size={size}
                open={menuToken !== null && menuToken.sentence === i && menuToken.index === segment.index}
                handlers={handlers}
              />
            ),
          )}
        </p>
      ))}
      {children}
    </div>
  );
}

function Word({
  token,
  sentence,
  sentenceIndex,
  index,
  focusEntSeqs,
  size,
  open,
  handlers,
}: {
  token: StoryToken;
  sentence: StorySentence;
  sentenceIndex: number;
  index: number;
  focusEntSeqs: ReadonlySet<number>;
  size: StoryTextSize;
  open: boolean;
  handlers: StoryTextHandlers;
}) {
  const ref: TokenRef = { sentence: sentenceIndex, index };
  const inGrammarSpan = spansCovering(token, sentence.grammarSpans).length > 0;
  // A word opens a Lookup only when there is something behind it: a Dictionary
  // Entry, or the Grammar Span it sits in.
  const interactive = token.entSeq !== undefined || inGrammarSpan;
  const marks = tokenMarks(token, sentence.grammarSpans, focusEntSeqs);
  const ruby = showsFurigana(token);

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handlers.onTokenActivate(ref, e.currentTarget);
    }
  };
  const onClick = (e: MouseEvent<HTMLSpanElement>) => {
    handlers.onTokenActivate(ref, e.currentTarget);
  };

  return (
    <span
      data-token={`${sentenceIndex}-${index}`}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-haspopup={interactive ? "dialog" : undefined}
      aria-expanded={interactive ? open : undefined}
      aria-label={ruby ? token.surface : undefined}
      onMouseEnter={interactive ? () => handlers.onTokenEnter(ref) : undefined}
      onMouseLeave={interactive ? () => handlers.onTokenLeave(ref) : undefined}
      onFocus={interactive ? () => handlers.onTokenFocus(ref) : undefined}
      onBlur={interactive ? () => handlers.onTokenBlur(ref) : undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      className={cn(
        marks.grammar === "grammarFocus" && "box-decoration-clone rounded-sm bg-grammar-focus",
        marks.grammar === "grammar" && "box-decoration-clone rounded-sm bg-grammar",
        marks.underline === "lookup" && "underline decoration-dotted decoration-1 underline-offset-[0.25em] decoration-lookup-mark",
        marks.underline === "focus" && "underline decoration-2 underline-offset-[0.25em] decoration-focus",
        interactive && "rounded-sm",
      )}
    >
      {ruby ? (
        <ruby>
          {token.surface}
          <rt className={cn("text-furigana", furiganaSizeClass(size))}>{token.reading}</rt>
        </ruby>
      ) : (
        token.surface
      )}
    </span>
  );
}

/**
 * The reading's size class for the saved Story text size. Every step has its
 * own token in @vjt/design (the bare `--text-furigana` has none, so M is named
 * too); the `text-furigana` colour class rides alongside it on the <rt>. The
 * names are written out in full: Tailwind only generates classes it can see.
 */
const FURIGANA_SIZE_CLASS: Record<StoryTextSize, string> = {
  S: "text-furigana-s",
  M: "text-furigana-m",
  L: "text-furigana-l",
  XL: "text-furigana-xl",
};

export function furiganaSizeClass(size: StoryTextSize): string {
  return FURIGANA_SIZE_CLASS[size];
}

/**
 * A sentence as plain ruby, for the Reading Panel's sentence mode: the same
 * furigana rule, no marks and no gestures.
 */
export function RubyText({ tokens, size }: { tokens: StoryToken[]; size: StoryTextSize }) {
  return (
    <>
      {tokens.map((token, j) =>
        showsFurigana(token) ? (
          <ruby key={j}>
            {token.surface}
            <rt className={cn("text-furigana", furiganaSizeClass(size))}>{token.reading}</rt>
          </ruby>
        ) : (
          <Fragment key={j}>{token.surface}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Copies of a selection inside the column carry the Japanese alone: the rt
 * readings are removed from the copied range. The copy event fires on the focused
 * element, which may be outside the column, so the listener is document-wide and
 * only acts when the selection starts and ends inside the column.
 */
function useCleanCopy(columnRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const column = columnRef.current;
      const selection = window.getSelection();
      if (!column || !selection || selection.rangeCount === 0 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!column.contains(range.commonAncestorContainer)) return;
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", plainJapanese(range.cloneContents()));
      event.preventDefault();
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, [columnRef]);
}
