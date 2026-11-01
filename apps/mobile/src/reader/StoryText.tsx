import type { StoryGrammarSpan, StorySentence, StoryToken } from "@vjt/api-client";
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type NativeSyntheticEvent, type NativeTouchEvent } from "react-native";

import { useColors } from "../theme.ts";
import { coveringSpan, type TokenRef } from "./holdMenu.ts";

/**
 * The story body: every sentence is a paragraph whose tokens are touchable.
 * A token's press begins the Lookup gesture (the handlers come from the
 * reader — this file only renders and forwards), and a press anywhere else in
 * the paragraph just selects its sentence, as the web paragraph click does.
 *
 * Furigana: react-native has no ruby element, so a token with showFurigana
 * stacks its reading above its surface as one small inline block — one text
 * line for the reading, one for the word. Underline rules match the web
 * reader: solid = Known Item, dotted = unknown with a dictionary entry, none
 * = unlinked; Grammar Spans override with a purple wavy underline (thicker
 * for the story's Focus Grammar). (Android may render wavy as its own
 * underline style — the colour still carries the meaning.)
 */

export interface TokenHandlers {
  onStartShouldSetResponder: () => boolean;
  onResponderGrant: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
  onResponderMove: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
  onResponderRelease: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
  onResponderTerminate: (e: NativeSyntheticEvent<NativeTouchEvent>) => void;
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

/** The word with its furigana stacked above it when the server asked for ruby. */
export function TokenWords({ token, style }: { token: StoryToken; style?: object }) {
  const colors = useColors();
  const ruby = token.showFurigana && token.reading && token.reading !== token.surface;
  return (
    <Text style={style}>
      {ruby ? (
        <Text style={{ fontSize: 11, color: colors.subtle }}>{token.reading}</Text>
      ) : null}
      {ruby ? "\n" : null}
      {token.surface}
    </Text>
  );
}

/**
 * One paragraph of the story. `activeToken` lights up the pressed token, and
 * while a Grammar Span token is pressed every token the Span covers lights up
 * too — the whole Span reads as one unit, like the web hover.
 */
export function StoryParagraph({
  sentence,
  sentenceIndex,
  activeToken,
  handlers,
  onSelect,
}: {
  sentence: StorySentence;
  sentenceIndex: number;
  activeToken: TokenRef | null;
  /** Gesture handlers per token index (stable identity is not required). */
  handlers: (index: number) => TokenHandlers;
  onSelect: () => void;
}) {
  const colors = useColors();
  const activeTok = activeToken?.sentence === sentenceIndex ? sentence.tokens[activeToken.index] : undefined;
  const activeSpan = activeTok ? coveringSpan(sentence, activeTok) : null;
  return (
    <View
      onStartShouldSetResponder={() => true}
      onResponderGrant={onSelect}
      accessibilityLabel={`Sentence ${sentenceIndex + 1}`}
      style={styles.paragraph}
    >
      <Text style={[styles.body, { color: colors.label }]}>
        {sentenceNodes(sentence, (tok, j) => (
          <StoryToken
            key={j}
            token={tok}
            sentenceIndex={sentenceIndex}
            index={j}
            spans={sentence.grammarSpans}
            active={
              (activeToken?.sentence === sentenceIndex && activeToken.index === j) ||
              (activeSpan !== null && coveringSpan(sentence, tok) === activeSpan)
            }
            handlers={handlers(j)}
          />
        ))}
      </Text>
    </View>
  );
}

/** A token in the story body: touchable, underlined by its item status. */
function StoryToken({
  token,
  sentenceIndex,
  index,
  spans,
  active,
  handlers,
}: {
  token: StoryToken;
  sentenceIndex: number;
  index: number;
  spans: StoryGrammarSpan[];
  active: boolean;
  handlers: TokenHandlers;
}) {
  const colors = useColors();
  const covered = spans.filter((sp) => token.start < sp.end && sp.start < token.end);
  const style: object[] = [{ textDecorationLine: "underline" }];
  if (covered.length > 0) {
    const focus = covered.some((sp) => sp.isFocus);
    // The web marks Focus Grammar with a thicker wavy line; Android cannot
    // vary underline thickness, so the focus Span gets a darker solid line
    // instead — the colour still separates it from plain Grammar spans.
    style.push(
      focus
        ? { textDecorationStyle: "solid", textDecorationColor: "#5b21b6" }
        : { textDecorationStyle: "wavy", textDecorationColor: "#7c3aed" },
    );
  } else if (token.tag === "known") {
    style.push({ textDecorationStyle: "solid", textDecorationColor: colors.subtle });
  } else if (token.entSeq !== undefined) {
    style.push({ textDecorationStyle: "dotted", textDecorationColor: colors.subtle });
  } else {
    style.push({ textDecorationLine: "none" });
  }
  if (active) style.push({ backgroundColor: `${colors.accent}33` });
  const ruby = token.showFurigana && token.reading && token.reading !== token.surface;
  return (
    <Text
      testID={`token-${sentenceIndex}-${index}`}
      accessibilityLabel={`${token.surface}${token.reading && ruby ? ` (${token.reading})` : ""}`}
      {...handlers}
    >
      {ruby ? (
        <Text style={{ fontSize: 11, color: colors.subtle }}>{token.reading}</Text>
      ) : null}
      {ruby ? "\n" : null}
      <Text style={style}>{token.surface}</Text>
    </Text>
  );
}

const styles = StyleSheet.create({
  paragraph: { paddingVertical: 4 },
  body: { fontSize: 18, lineHeight: 30 },
});
