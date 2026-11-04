import type { Story, StoryGrammarSpan } from "@vjt/api-client";
import type { ReadingSettingsView } from "@vjt/core";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useStoryTextSize } from "../storysize/index.tsx";
import { coveringSpan } from "./holdMenu.ts";
import { countGlosses, firstGlosses, JlptBadge } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";
import { TokenWords } from "./StoryText.tsx";
import type { EntryLookup } from "./useEntryLookup.ts";

/**
 * The Reading Panel (issues #14, #45): ONE fixed box above the story that
 * never moves as the story scrolls and never resizes as lookups come and go.
 * Both of its edges come from the saved Story text size — it is as wide as the
 * 40-character column below it and seven lines of that size tall — and it
 * scales with the size, never with content. Whatever is inside rides in one
 * scroll container, so a sentence or a gloss list longer than the box is
 * scrolled, not clipped. Inside the box:
 *
 *   sentence-mode (idle): the selected sentence (with furigana) and its
 *     Sentence Translation;
 *   lookup-mode (a token pressed or held): the Lookup row
 *     for that word or Grammar Span (testID `panel-lookup`), while the
 *     Sentence Translation row stays put.
 *
 * The Sentence Translation starts hidden (a saved reading setting): Android
 * has no CSS filter, so the row renders its text invisible instead. Either way it is
 * one tap to reveal: the tap saves the preference and reports the sentence's
 * Focus Set items as Weak Signals.
 */

/** The panel is 7 story-text lines tall (plan 4.1). */
export const PANEL_LINES = 7;

/** What the Lookup row is describing: the pressed token, or its Grammar Span. */
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
  const { fontSizePx, lineHeightPx, columnWidthPx } = useStoryTextSize();
  const blur = reading.state.status === "ready" ? reading.state.settings.blurTranslation : true;
  const sen = selected !== null ? story.sentences[selected] : null;
  const [blurError, setBlurError] = useState<string | null>(null);

  // A failed save leaves the stored preference — and the screen — as they
  // were; what changes is the message that says the click did not stick, and
  // the Retry that sends the same save again (review on #45). A *successful*
  // reveal is a Weak Signal for the sentence's Focus Set items (issue #12):
  // the Learner reached for the answer.
  const toggleBlur = async () => {
    // Any attempt retires the previous failure, whether it comes from the row
    // or from Retry: the message never outlives the save it was about.
    setBlurError(null);
    const revealing = blur;
    const res = await reading.setBlurTranslation(!blur);
    setBlurError(res.ok ? null : res.message);
    if (res.ok && revealing && selected !== null) onUnblur(selected);
  };

  return (
    <View
      testID="reading-panel"
      accessibilityLabel="Reading Panel"
      className="bg-card border-border"
      // Both edges are the saved Story text size talking: as wide as the
      // 40-character column it sits above, and PANEL_LINES lines of that size
      // tall. Neither depends on what is showing, so the story below the panel
      // never shifts as lookups come and go (review on #45).
      style={[styles.panel, { height: PANEL_LINES * fontSizePx, width: columnWidthPx }]}
    >
      {/* Everything inside rides in one scroll container: a long sentence or a
          long list of glosses is reached by scrolling, never cut off in
          silence. */}
      <ScrollView testID="panel-scroll" style={styles.body}>
        {looked ? (
          <View accessibilityLabel="Lookup row" style={styles.wordMode}>
            {/* Fixed label, outside the conditional content: it keeps its slot
                so the box never shifts as lookups come and go. */}
            <Text className="text-caption text-muted-foreground" style={styles.lookupLabel}>
              Word meaning
            </Text>
            <LookupRow story={story} looked={looked} lookup={lookup} />
          </View>
        ) : (
          <View style={styles.sentenceMode}>
            {sen ? (
              // The selected sentence at the same size the story is set to, so
              // the panel reads as the same text, quoted.
              <Text
                className="text-foreground"
                style={{
                  fontSize: fontSizePx,
                  lineHeight: lineHeightPx,
                  padding: 8,
                  paddingBottom: 4,
                }}
              >
                {sen.tokens.map((tok, j) => (
                  <TokenWords key={j} token={tok} />
                ))}
              </Text>
            ) : (
              <Text className="text-small text-muted-foreground" style={styles.hint}>
                Tap a word or punctuation to select its sentence.
              </Text>
            )}
          </View>
        )}
        {reading.state.status === "error" ? (
          <Text className="text-small text-muted-foreground" style={styles.note}>
            (reading settings unavailable — {reading.state.message})
          </Text>
        ) : null}

        {/* The Sentence Translation row keeps its slot in BOTH modes: the panel
            never rearranges while a Lookup is up. */}
        {sen ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sentence Translation"
            accessibilityHint={blur ? "Tap to show the translation" : "Tap to hide the translation"}
            onPress={() => void toggleBlur()}
            // The blur is the row's own inline style: Android has no filter
            // support, so the hidden translation is made transparent.
            style={blur ? [styles.translationRow, { opacity: 0 }] : styles.translationRow}
          >
            <Text className="text-small text-muted-foreground" style={styles.translation}>
              {sen.en}
            </Text>
          </Pressable>
        ) : null}
        {sen && blur ? (
          <Text testID="translation-hidden-note" className="text-caption text-muted-foreground" style={styles.blurNote}>
            Translation hidden — tap to show
          </Text>
        ) : null}
        {blurError ? (
          // The message says the reveal did not stick; the button beside it is
          // the explicit way to send that same save again, so the Learner
          // does not have to work out that tapping the blurred row again is
          // what a retry means.
          <View style={styles.errorRow}>
            <Text accessibilityRole="alert" className="text-small text-destructive" style={styles.errorText}>
              Could not save that — {blurError}
            </Text>
            <Pressable
              testID="blur-retry"
              accessibilityRole="button"
              accessibilityLabel="Retry saving the translation setting"
              onPress={() => void toggleBlur()}
              className="border-border"
              style={styles.retry}
            >
              <Text className="text-small text-foreground">Retry</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * The Lookup row (testID `panel-lookup`). A word: the word, its reading, each
 * gloss on its own line, and on the right the pitch graph with its caption
 * then the JLPT badge — all from the cached entry the press
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
      <Text className="text-body text-pitch" style={styles.lookupWord}>
        {token.surface}
      </Text>
      {token.reading && token.reading !== token.surface ? (
        <Text className="text-body text-focus">
          {token.reading}
        </Text>
      ) : null}
      {glosses.map((gloss, i) => (
        <Text key={i} className="text-small text-foreground">
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
      <Text className="text-body text-pitch" style={styles.lookupWord}>
        {span.pattern}
      </Text>
      <Text className="text-small text-foreground">
        {span.meaning}
      </Text>
      <View style={styles.lookupRight}>{span.jlptLevel ? <JlptBadge level={span.jlptLevel} /> : null}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    // The inline style sets the size from the saved Story text size: 40
    // characters wide (the column below) and PANEL_LINES lines tall. One fixed
    // box for both modes, so lookups and long sentences can never resize it
    // and the story under it never shifts.
    alignSelf: "center",
    maxWidth: "100%",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    flexDirection: "column",
  },
  // The one scroll container inside the fixed box.
  body: { flex: 1 },
  wordMode: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  sentenceMode: { paddingHorizontal: 4, paddingTop: 8 },
  hint: { padding: 8 },
  note: { paddingHorizontal: 12, paddingBottom: 6 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingBottom: 8 },
  errorText: { flex: 1, flexShrink: 1 },
  retry: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  translationRow: { paddingVertical: 6, paddingHorizontal: 12 },
  translation: { fontStyle: "italic" },
  blurNote: { paddingHorizontal: 12, paddingBottom: 8 },
  lookupLabel: { fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  lookupWord: { fontWeight: "600" },
  lookupContent: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  lookupRight: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 },
});
