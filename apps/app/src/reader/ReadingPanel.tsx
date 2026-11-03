import type { Story, StoryGrammarSpan } from "@vjt/api-client";
import type { ReadingSettingsView } from "@vjt/core";
import { useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef } from "react";

import { useStoryTextSize } from "../storysize/index.tsx";
import { coveringSpan } from "./holdMenu.ts";
import type { MeasurableNode } from "./holdMenu.ts";
import { countGlosses, firstGlosses, JlptBadge } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";
import { TokenWords } from "./StoryText.tsx";
import type { EntryLookup } from "./useEntryLookup.ts";

/**
 * The Reading Panel (issues #14, #45): ONE fixed box above the story that
 * never moves as the story scrolls and never resizes as lookups come and go.
 * Its height is seven lines of the current Story text size — it scales with
 * the saved size, but never with content. Inside the box:
 *
 *   sentence-mode (idle): the selected sentence (with furigana) and its
 *     Sentence Translation;
 *   lookup-mode (a token pressed, held, or hovered on web): the Lookup row
 *     for that word or Grammar Span (testID `panel-lookup`), while the
 *     Sentence Translation row stays put.
 *
 * The Sentence Translation starts blurred (a saved reading setting): the
 * whole row carries an inline `filter: blur(…)` on web, and Android — which
 * has no CSS filter — renders the text invisible instead. Either way it is
 * one tap to reveal: the tap saves the preference and reports the sentence's
 * Focus Set items as Weak Signals.
 */

/** The panel is 7 story-text lines tall (plan 4.1). */
export const PANEL_LINES = 7;

/** What the Lookup row is describing: the pressed/hovered token, or its Grammar Span. */
export interface LookedTarget {
  sentence: number;
  index: number;
  kind: "token" | "grammar";
}

export function ReadingPanel({
  story,
  selected,
  looked,
  reading,
  lookup,
  onUnblur,
}: {
  story: Story;
  selected: number | null;
  looked: LookedTarget | null;
  reading: ReadingSettingsView;
  lookup: EntryLookup;
  /** Reports Weak Signals when a blurred Sentence Translation is revealed. */
  onUnblur: (sentenceIdx: number) => void;
}) {
  const { fontSizePx } = useStoryTextSize();
  const blur = reading.state.status === "ready" ? reading.state.settings.blurTranslation : true;
  const sen = selected !== null ? story.sentences[selected] : null;
  const [blurError, setBlurError] = useState<string | null>(null);

  // The fixed height has two proofs on web: the StyleSheet height (7 lines at
  // the default size) lands in an atomic CSS rule, and the CURRENT size rides
  // on the element's inline style, which the browser lets win. RNW otherwise
  // keeps a height either as a class or inline — never both — so the inline
  // copy is written here once the size changes. (Android takes it from the
  // style prop instead; there is no CSSOM to speak of.)
  const panelRef = useRef<MeasurableNode | null>(null);
  useEffect(() => {
    const el = panelRef.current as unknown as HTMLElement | null;
    if (el && typeof el.style?.setProperty === "function") {
      el.style.height = `${PANEL_LINES * fontSizePx}px`;
    }
  }, [fontSizePx]);

  // A failed save leaves the stored preference — and the screen — as they
  // were; the only change is the message that says the click did not stick.
  // A *successful* reveal is a Weak Signal for the sentence's Focus Set
  // items (issue #12): the Learner reached for the answer.
  const toggleBlur = async () => {
    const revealing = blur;
    const res = await reading.setBlurTranslation(!blur);
    setBlurError(res.ok ? null : res.message);
    if (res.ok && revealing && selected !== null) onUnblur(selected);
  };

  return (
    <View
      ref={(node) => {
        panelRef.current = node;
      }}
      testID="reading-panel"
      accessibilityLabel="Reading Panel"
      className="bg-card border-border"
      style={Platform.OS === "web" ? styles.panel : [styles.panel, { height: PANEL_LINES * fontSizePx }]}
    >
      {looked ? (
        <View accessibilityLabel="Lookup row" style={styles.wordMode}>
          {/* Fixed label, outside the conditional content: it keeps its slot
              so the box never shifts as lookups come and go. */}
          <Text className="text-muted-foreground" style={styles.lookupLabel}>
            Word meaning
          </Text>
          <LookupRow story={story} looked={looked} lookup={lookup} />
        </View>
      ) : (
        <View style={styles.sentenceMode}>
          <ScrollView style={styles.sentenceBox}>
            {sen ? (
              <Text className="text-foreground" style={styles.panelSentence}>
                {sen.tokens.map((tok, j) => (
                  <TokenWords key={j} token={tok} />
                ))}
              </Text>
            ) : (
              <Text className="text-muted-foreground" style={{ fontSize: 14 }}>
                Tap a word or punctuation to select its sentence.
              </Text>
            )}
          </ScrollView>
          {reading.state.status === "error" ? (
            <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
              (reading settings unavailable — {reading.state.message})
            </Text>
          ) : null}
        </View>
      )}

      {/* The Sentence Translation row keeps its slot in BOTH modes: the panel
          never rearranges while a Lookup is up. */}
      {sen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sentence Translation"
          accessibilityHint={blur ? "Tap to show the translation" : "Tap to hide the translation"}
          onPress={() => void toggleBlur()}
          // The blur is the row's own inline style: web applies a real CSS
          // filter; Android (no filter support) hides the text outright.
          style={
            blur
              ? Platform.OS === "web"
                ? [styles.translationRow, { filter: "blur(5px)" }]
                : [styles.translationRow, { opacity: 0 }]
              : styles.translationRow
          }
        >
          <Text className="text-muted-foreground" style={styles.translation}>
            {sen.en}
          </Text>
        </Pressable>
      ) : null}
      {sen && blur ? (
        <Text testID="translation-hidden-note" className="text-muted-foreground" style={styles.blurNote}>
          Translation hidden — tap to show
        </Text>
      ) : null}
      {blurError ? (
        <Text accessibilityRole="alert" className="text-destructive" style={{ fontSize: 14, paddingHorizontal: 12 }}>
          Could not save that — {blurError}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The Lookup row (testID `panel-lookup`). A word: the word, its reading, each
 * gloss on its own line, and on the right the pitch graph with its caption
 * then the JLPT badge — all from the cached entry the press or hover
 * triggered, so repeat lookups are instant. A Grammar Span instead shows the
 * Grammar Point's pattern and meaning straight from the story payload — no
 * request needed.
 */
function LookupRow({
  story,
  looked,
  lookup,
}: {
  story: Story;
  looked: LookedTarget;
  lookup: EntryLookup;
}) {
  const sen = story.sentences[looked.sentence];
  if (!sen) return null;
  const token = sen.tokens[looked.index];
  if (!token) return null;
  if (looked.kind === "grammar") {
    const span = coveringSpan(sen, token);
    if (!span) return null;
    return <GrammarGloss span={span} />;
  }
  const entry = token.entSeq !== undefined ? lookup.peek(token.entSeq, token.surface, token.reading) : undefined;
  // The row only appears once there is real data to show: a lookup in flight,
  // a failed one, or a word with no dictionary link at all renders nothing —
  // the fixed "Word meaning" label above still marks the mode.
  if (!entry) return null;
  const glosses = firstGlosses(entry, 2);
  const more = countGlosses(entry) > glosses.length;
  return (
    <View testID="panel-lookup" style={styles.lookupContent}>
      <Text className="text-pitch" style={{ fontSize: 16, fontWeight: "600" }}>
        {token.surface}
      </Text>
      {token.reading && token.reading !== token.surface ? (
        <Text className="text-focus" style={{ fontSize: 15 }}>
          {token.reading}
        </Text>
      ) : null}
      {glosses.map((gloss, i) => (
        <Text key={i} className="text-foreground" style={{ fontSize: 14 }}>
          {gloss}
          {more && i === glosses.length - 1 ? "…" : ""}
        </Text>
      ))}
      <View style={styles.lookupRight}>
        {entry?.pitch ? <PitchGraph pitch={entry.pitch} withCaption /> : null}
        {entry?.jlptLevel ? <JlptBadge level={entry.jlptLevel} /> : null}
      </View>
    </View>
  );
}

function GrammarGloss({ span }: { span: StoryGrammarSpan }) {
  return (
    <View testID="panel-lookup" style={styles.lookupContent}>
      <Text className="text-pitch" style={{ fontSize: 16, fontWeight: "600" }}>
        {span.pattern}
      </Text>
      <Text className="text-foreground" style={{ fontSize: 14 }}>
        {span.meaning}
      </Text>
      <View style={styles.lookupRight}>{span.jlptLevel ? <JlptBadge level={span.jlptLevel} /> : null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    // One fixed height for both modes (the inline style scales it by the
    // Story text size): lookups and long sentences can never resize the
    // panel, so the story below it never shifts.
    height: 147, // 7 × the default M size (21px)
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    overflow: "hidden",
    flexDirection: "column",
  },
  wordMode: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  sentenceMode: { flex: 1, paddingHorizontal: 4, paddingTop: 8 },
  sentenceBox: { flex: 1 },
  panelSentence: { fontSize: 18, lineHeight: 28, padding: 8, paddingBottom: 4 },
  translationRow: { paddingVertical: 6, paddingHorizontal: 12 },
  translation: { fontSize: 14, fontStyle: "italic" },
  blurNote: { fontSize: 12, paddingHorizontal: 12, paddingBottom: 8 },
  lookupLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  lookupContent: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  lookupRight: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 },
});
