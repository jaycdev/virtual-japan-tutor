import type { StoryGrammarSpan, StorySentence, StoryToken } from "@vjt/api-client";
import { forwardRef, memo, type ReactNode } from "react";
import { StyleSheet, Text, View, type NativeSyntheticEvent, type NativeTouchEvent } from "react-native";

import { useStoryTextSize } from "../storysize/index.tsx";
import { type MeasurableNode, type TokenRef } from "./holdMenu.ts";

/**
 * The story body (issues #14, #45): centred serif text in a column 40
 * characters wide, sized by the saved Story text size. Marks follow the ticket:
 *   Known Item          → no mark at all
 *   lookup-marked word  → its own underline element (class `border-lookup-mark`):
 *                         a View border, which paints on Android
 *   Grammar Span        → a rounded highlighter background, stronger for Focus Spans
 *   selected token      → the selected-token background
 *
 * Layout is a token column (issue #45 review, blocker 2): each token is its own
 * View — a flex row of columns wraps per sentence — with a fixed-height reading
 * slot above the word. The slot is always reserved, so words on one line share
 * a baseline whether or not the token carries furigana, and the reading paints
 * directly above its word. (The old `word + "\n" + reading` nested-Text trick is
 * gone: on Android it broke the reading out of the word's line and reflowed the
 * whole sentence.)
 *
 * The tap target is the whole column, so a Learner can press the reading, the
 * word, or the space between them. Punctuation the tokeniser left out stays a
 * plain span with no gesture of its own — a press there selects the sentence.
 *
 * A token's press begins the Lookup gesture — the reader's per-token handler
 * objects are SPREAD onto the column (its responder wiring is what lets the
 * ScrollView steal a swipe, see StoryReader) — and a press anywhere else in
 * the paragraph just selects its sentence.
 */

/** The gesture props the reader builds per token (holdMenu machine, StoryReader). */
export interface TokenHandlers {
  onStartShouldSetResponder: () => boolean;
  onResponderGrant: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
  onResponderMove: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
  onResponderRelease: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
  onResponderTerminate: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
  onResponderTerminationRequest: () => boolean;
}

/**
 * Render a sentence's tokens in order, splicing in any characters the
 * tokeniser left out (punctuation) as plain text, using the codepoint offsets
 * both the server and String iterators agree on for this text.
 */
export function sentenceNodes(
  sentence: StorySentence,
  renderToken: (token: StoryToken, index: number) => ReactNode,
  renderGap: (text: string, key: string) => ReactNode = (text, key) => <Text key={key}>{text}</Text>,
): ReactNode[] {
  const chars = Array.from(sentence.ja);
  const out: ReactNode[] = [];
  let cursor = 0;
  sentence.tokens.forEach((tok, j) => {
    if (tok.start > cursor) {
      const key = `gap-${j}`;
      out.push(renderGap(chars.slice(cursor, tok.start).join(""), key));
    }
    out.push(renderToken(tok, j));
    cursor = Math.max(cursor, tok.end);
  });
  if (cursor < chars.length) out.push(renderGap(chars.slice(cursor).join(""), "gap-end"));
  return out;
}

/** True when the word gets the lookup underline: linked, and not a Known Item. */
export function isLookupMarked(token: StoryToken): boolean {
  return token.entSeq !== undefined && token.tag !== "known";
}

/** The classes for the token's marks, from the ticket's four cases. */
export function tokenMarkClasses(
  token: StoryToken,
  spans: StoryGrammarSpan[],
  selected: boolean,
): string[] {
  const classes: string[] = [];
  if (selected) classes.push("bg-selected-sentence");
  const covered = spans.filter((sp) => token.start < sp.end && sp.start < token.end);
  if (covered.length > 0) {
    // The highlighter swipe is rounded (review on #45): a square block of
    // colour around a word reads as a table cell, not a mark. The radius rides
    // with the colour so a mark can never arrive without its shape.
    classes.push(covered.some((sp) => sp.isFocus) ? "bg-grammar-focus rounded-sm" : "bg-grammar rounded-sm");
  }
  if (isLookupMarked(token)) classes.push("border-lookup-mark");
  return classes;
}

/** Furigana classes: the base size always, the size step away from the default. */
export function furiganaClasses(size: "S" | "M" | "L" | "XL"): string {
  return size === "M" ? "text-furigana" : `text-furigana text-furigana-${size.toLowerCase()}`;
}

/**
 * The reading size for a story-text size — half the word's font size, the
 * same ratio the `--text-furigana-*` steps keep (9/10.5/12/14 for 18/21/24/28).
 * Exported because the Reading Panel reserves the same slot.
 */
export function furiganaPxFor(fontSizePx: number): number {
  return fontSizePx / 2;
}

/**
 * A token as the panel renders it: reading stacked over surface in one inline
 * Text, for flows that stay plain text (the panel's sentence mode). The story
 * body uses the token-column layout below instead.
 */
export function TokenWords({ token, size }: { token: StoryToken; size?: "S" | "M" | "L" | "XL" }) {
  const { size: storySize } = useStoryTextSize();
  const ruby = token.showFurigana && token.reading !== undefined && token.reading !== "";
  return (
    <Text>
      {ruby ? <Text className={furiganaClasses(size ?? storySize)}>{token.reading}</Text> : null}
      {ruby ? "\n" : null}
      {token.surface}
    </Text>
  );
}

interface StoryTokenProps {
  token: StoryToken;
  sentenceIndex: number;
  index: number;
  spans: StoryGrammarSpan[];
  /** The token the Learner last selected — its sentence's background tints it. */
  selected: boolean;
  /** Gesture props, spread straight onto the token column. */
  handlers: TokenHandlers;
  /** The saved Story text size (the word's font size; the reading is half). */
  fontSizePx: number;
  /** The line height matching that size (mirrors the CSS token, not a magic 1.4). */
  lineHeightPx: number;
}

/**
 * One token: a column View — the reserved reading slot, the word, and (when
 * lookup-marked) its own underline element. It carries the gesture wiring and
 * the `token-{sentence}-{index}` / `furigana-{sentence}-{index}` test handles.
 */
const StoryToken = forwardRef<MeasurableNode | null, StoryTokenProps>(function StoryToken(
  { token, sentenceIndex, index, spans, selected, handlers, fontSizePx, lineHeightPx },
  ref,
) {
  const { size } = useStoryTextSize();

  const classes = tokenMarkClasses(token, spans, selected);
  // The highlighter marks belong to the WORD (the reading above stays clear of
  // them); the lookup underline is its own element at the column's bottom —
  // a View border paints on Android, where nested-Text borders do not.
  const wordClasses = classes.filter((c) => c !== "border-lookup-mark");
  const ruby = token.showFurigana === true && token.reading !== undefined && token.reading !== "";
  const furiganaSlotPx = furiganaPxFor(fontSizePx);

  return (
    <View
      ref={(el) => {
        const node = el as unknown as MeasurableNode | null;
        if (typeof ref === "function") ref(node);
        else if (ref !== null) (ref as { current: MeasurableNode | null }).current = node;
      }}
      testID={`token-${sentenceIndex}-${index}`}
      accessibilityLabel={`${token.surface}${ruby ? ` (${token.reading})` : ""}`}
      {...handlers}
    >
      {/* The reading slot: always the same height, furigana or not, so every
          word on the line shares its baseline. leading-none keeps the reading
          Text exactly `furiganaSlotPx` tall on both platforms. */}
      {ruby ? (
        <Text
          key={"ruby-" + size}
          testID={`furigana-${sentenceIndex}-${index}`}
          className={furiganaClasses(size) + " text-center leading-none"}
          style={{ lineHeight: furiganaSlotPx }}
        >
          {token.reading}
        </Text>
      ) : (
        <View style={{ height: furiganaSlotPx }} />
      )}
      <Text
        // Fiber-visible marks (see the test suite's fiberClassTokens helper)
        // read the element's props; RN's Text can retain its first-pass props
        // across a class-only update, so the marked span is keyed by its marks
        // and gets a fresh fiber when the marks change.
        key={"m-" + wordClasses.join("-")}
        className={wordClasses.length > 0 ? wordClasses.join(" ") : undefined}
        style={{ fontSize: fontSizePx, lineHeight: lineHeightPx, textAlign: "center" }}
      >
        {token.surface}
      </Text>
      {isLookupMarked(token) ? (
        <View
          key={"mark-" + sentenceIndex + "-" + index}
          className="border-lookup-mark"
          style={styles.lookupUnderline}
        />
      ) : null}
    </View>
  );
});

/**
 * One paragraph of the story: a flex row of token columns that wraps per
 * sentence, centred line by line. Memoised (issue #14 review, minor 6): the
 * reader caches `handlers` and `onSelect` across renders, so header notes,
 * panel updates and answer feedback re-render only the paragraphs whose
 * selected token actually changed.
 */
export const StoryParagraph = memo(function StoryParagraph({
  sentence,
  sentenceIndex,
  selectedToken,
  handlers,
  onSelect,
  fontSizePx,
  lineHeightPx,
}: {
  sentence: StorySentence;
  sentenceIndex: number;
  /** The token the Learner last selected (the background mark), in this paragraph. */
  selectedToken: TokenRef | null;
  /** Gesture handlers per token (one stable function; the per-token objects are cached by the reader). */
  handlers: (sentenceIndex: number, index: number) => TokenHandlers;
  /** Stable selector: which sentence was pressed anywhere in this paragraph. */
  onSelect: (sentenceIndex: number) => void;
  /** The saved Story text size (the column's font). */
  fontSizePx: number;
  /** The line height matching that size (see the storysize store). */
  lineHeightPx: number;
}) {
  // Centred line-by-line via the flex container itself (issue #45): each
  // wrapped line of token columns sits in the middle of the 40-character box.
  // `alignItems: "flex-end"` keeps bare punctuation spans on the word baseline
  // next to columns, whose words sit at the bottom of their reading slots.
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderGrant={() => onSelect(sentenceIndex)}
      accessibilityLabel={`Sentence ${sentenceIndex + 1}`}
      style={styles.paragraph}
    >
      {sentenceNodes(sentence, (tok, j) => (
        <StoryToken
          key={j}
          token={tok}
          sentenceIndex={sentenceIndex}
          index={j}
          spans={sentence.grammarSpans}
          selected={selectedToken !== null && selectedToken.sentence === sentenceIndex && selectedToken.index === j}
          handlers={handlers(sentenceIndex, j)}
          fontSizePx={fontSizePx}
          lineHeightPx={lineHeightPx}
        />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  paragraph: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "flex-end",
    paddingVertical: 4,
  },
  lookupUnderline: {
    // The lookup mark is its own element spanning the column, not a text
    // decoration: View borders paint reliably on Android.
    alignSelf: "stretch",
    borderBottomWidth: 1,
    borderStyle: "dotted",
  },
});
