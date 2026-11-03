import type { StoryGrammarSpan, StorySentence, StoryToken } from "@vjt/api-client";
import { forwardRef, memo, useEffect, useRef, type ReactNode } from "react";
import { Platform, StyleSheet, Text, View, type NativeSyntheticEvent, type NativeTouchEvent } from "react-native";

import { useStoryTextSize } from "../storysize/index.tsx";
import { type MeasurableNode, type TokenRef } from "./holdMenu.ts";

/**
 * The story body (issue #45): centred serif text in a column 40 characters
 * wide, sized by the saved Story text size. Marks follow the ticket:
 *   Known Item          → no mark at all
 *   lookup-marked word  → a 1px underline (class `border-lookup-mark`, the
 *                         border colour from the theme token)
 *   Grammar Span        → a highlighter background, stronger for Focus Spans
 *   selected token      → the selected-sentence background
 * Furigana rides above the word in its own colour and scales with the story
 * text size (`text-furigana`, plus `text-furigana-<size>` away from M).
 *
 * A token's press begins the Lookup gesture — the reader's per-token handler
 * objects are SPREAD onto the token (its responder wiring is what lets the
 * ScrollView steal a swipe, see StoryReader) — and a press anywhere else in
 * the paragraph just selects its sentence. On web the token element also
 * listens for native `mouseover` (hover lookup) and `contextmenu` (right-click
 * opens the Lookup menu at the pointer), because a mouse never fires RN's
 * press events.
 *
 * Android has no ruby element, so furigana stacks the reading on its own line
 * above the word; and nested-Text borders are flaky there, so the lookup
 * underline falls back to a plain textDecorationLine on native while the
 * class token still describes the intent (web paints the real dotted border).
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

/** Extra props a web host adds to a token: hover lookup and right-click menu. */
export interface TokenWebHostHandlers {
  /** Pointer entered the token — look it up in the Reading Panel. */
  onHover: (ref: TokenRef, e: MouseEvent) => void;
  /** Right-click — open the Lookup menu at the pointer. */
  onContextMenu: (ref: TokenRef, e: MouseEvent) => void;
}

/**
 * Render a sentence's tokens in order, splicing in any characters the
 * tokeniser left out (punctuation) as plain text, using the codepoint offsets
 * both the server and String iterators agree on for this text.
 */
export function sentenceNodes(
  sentence: StorySentence,
  renderToken: (token: StoryToken, index: number) => ReactNode,
): ReactNode[] {
  const chars = Array.from(sentence.ja);
  const out: ReactNode[] = [];
  let cursor = 0;
  sentence.tokens.forEach((tok, j) => {
    if (tok.start > cursor) out.push(<Text key={`gap-${j}`}>{chars.slice(cursor, tok.start).join("")}</Text>);
    out.push(renderToken(tok, j));
    cursor = Math.max(cursor, tok.end);
  });
  if (cursor < chars.length) out.push(<Text key="gap-end">{chars.slice(cursor).join("")}</Text>);
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
  if (covered.length > 0) classes.push(covered.some((sp) => sp.isFocus) ? "bg-grammar-focus" : "bg-grammar");
  if (isLookupMarked(token)) classes.push("border-lookup-mark");
  return classes;
}

/** Furigana classes: the base size always, the size step away from the default. */
export function furiganaClasses(size: "S" | "M" | "L" | "XL"): string {
  return size === "M" ? "text-furigana" : `text-furigana text-furigana-${size.toLowerCase()}`;
}

/** The word with its furigana stacked above it when the server asked for ruby. */
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
  /** Gesture props, spread straight onto the token element. */
  handlers: TokenHandlers;
  /** Web only: hover lookup + right-click menu, attached to the DOM element. */
  webHandlers?: TokenWebHostHandlers;
}

/** A token in the story body: touchable, marked by its item status. */
const StoryToken = forwardRef<MeasurableNode | null, StoryTokenProps>(function StoryToken(
  { token, sentenceIndex, index, spans, selected, handlers, webHandlers },
  ref,
) {
  const { size } = useStoryTextSize();
  const localRef = useRef<MeasurableNode | null>(null);
  useEffect(() => {
    // Web only: a mouse has no RN press events, so hover and right-click come
    // in as DOM events on the rendered element (native refs have no such
    // method — the guard skips Android entirely).
    const host = localRef.current as unknown as HTMLElement | null;
    if (!host || typeof host.addEventListener !== "function") return;
    const ref_: TokenRef = { sentence: sentenceIndex, index };
    const over = (e: Event) => webHandlers?.onHover(ref_, e as MouseEvent);
    const menu = (e: Event) => {
      e.preventDefault();
      webHandlers?.onContextMenu(ref_, e as MouseEvent);
    };
    host.addEventListener("mouseover", over);
    host.addEventListener("contextmenu", menu);
    return () => {
      host.removeEventListener("mouseover", over);
      host.removeEventListener("contextmenu", menu);
    };
  }, [webHandlers, sentenceIndex, index]);

  const classes = tokenMarkClasses(token, spans, selected);
  const ruby = token.showFurigana && token.reading !== undefined && token.reading !== "";
  return (
    <Text
      ref={(el) => {
        const node = el as unknown as MeasurableNode | null;
        localRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref !== null) (ref as { current: MeasurableNode | null }).current = node;
      }}
      testID={`token-${sentenceIndex}-${index}`}
      accessibilityLabel={`${token.surface}${ruby ? ` (${token.reading})` : ""}`}
      {...handlers}
    >
      {ruby ? (
        <Text
          key={"ruby-" + size}
          testID={`furigana-${sentenceIndex}-${index}`}
          className={furiganaClasses(size)}
        >
          {token.reading}
        </Text>
      ) : null}
      {ruby ? "\n" : null}
      <Text
        // Fiber-visible marks (see the test suite's fiberClassTokens helper)
        // read the element's props; RN's Text can retain its first-pass props
        // across a class-only update, so the marked span is keyed by its marks
        // and gets a fresh fiber when the marks change.
        key={"m-" + classes.join("-")}
        className={classes.length > 0 ? classes.join(" ") : undefined}
        // Web paints the underline mark as a real 1px dotted border (its
        // colour from `border-lookup-mark`); Android cannot draw borders on
        // nested Text reliably, so it falls back to a text underline.
        style={
          isLookupMarked(token)
            ? Platform.OS === "web"
              ? { borderBottomWidth: 1, borderStyle: "dotted" }
              : { textDecorationLine: "underline" }
            : undefined
        }
      >
        {token.surface}
      </Text>
    </Text>
  );
});

/**
 * One paragraph of the story. Memoised (issue #14 review, minor 6): the
 * reader caches `handlers`, `webHandlers` and `onSelect` across renders, so
 * header notes, panel updates and answer feedback re-render only the
 * paragraphs whose selected token actually changed.
 */
export const StoryParagraph = memo(function StoryParagraph({
  sentence,
  sentenceIndex,
  selectedToken,
  handlers,
  webHandlers,
  onSelect,
  fontSizePx,
}: {
  sentence: StorySentence;
  sentenceIndex: number;
  /** The token the Learner last selected (the background mark), in this paragraph. */
  selectedToken: TokenRef | null;
  /** Gesture handlers per token (one stable function; the per-token objects are cached by the reader). */
  handlers: (sentenceIndex: number, index: number) => TokenHandlers;
  /** Web hover / right-click wiring (stable; undefined on native hosts). */
  webHandlers?: TokenWebHostHandlers;
  /** Stable selector: which sentence was pressed anywhere in this paragraph. */
  onSelect: (sentenceIndex: number) => void;
  /** The saved Story text size (the column's font). */
  fontSizePx: number;
}) {
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderGrant={() => onSelect(sentenceIndex)}
      accessibilityLabel={`Sentence ${sentenceIndex + 1}`}
      style={styles.paragraph}
    >
      <Text style={[styles.body, { fontSize: fontSizePx, lineHeight: Math.round(fontSizePx * 2.1) }]}>
        {sentenceNodes(sentence, (tok, j) => (
          <StoryToken
            key={j}
            token={tok}
            sentenceIndex={sentenceIndex}
            index={j}
            spans={sentence.grammarSpans}
            selected={selectedToken !== null && selectedToken.sentence === sentenceIndex && selectedToken.index === j}
            handlers={handlers(sentenceIndex, j)}
            webHandlers={webHandlers}
          />
        ))}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  paragraph: { paddingVertical: 4 },
  body: {}, // font-size and lineHeight ride inline (they follow the saved Story text size)
});
