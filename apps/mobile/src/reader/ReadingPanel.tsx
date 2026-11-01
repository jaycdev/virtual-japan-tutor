import type { DictionaryEntry, Story, StoryGrammarSpan, StoryToken } from "@vjt/api-client";
import type { ReadingSettingsView } from "@vjt/core";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MIN_TOUCH, useColors } from "../theme.ts";
import { coveringSpan, shouldShrink } from "./holdMenu.ts";
import { countGlosses, firstGlosses, JlptBadge } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";
import { TokenWords } from "./StoryText.tsx";
import type { EntryLookup } from "./useEntryLookup.ts";

/**
 * The Reading Panel (issue #14): a fixed-size area that never moves as the
 * story scrolls under it. The selected sentence (with furigana) and its
 * Sentence Translation live in a fixed box — long text first shrinks one
 * step, then scrolls inside the box — and the Lookup row below it is a
 * single fixed line led by the fixed "Word meaning" label, so the panel
 * keeps its size while lookups come and go.
 *
 * Android has no CSS blur, so the blurred Sentence Translation is rendered
 * as transparent text with an opaque "hidden" overlay over it: same tap to
 * reveal, same layout, nothing readable to a screen reader either.
 */

const SENTENCE_BOX_HEIGHT = 96;
const LOOKUP_ROW_HEIGHT = 44;

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
  const colors = useColors();
  const blur = reading.state.status === "ready" ? reading.state.settings.blurTranslation : true;
  const sen = selected !== null ? story.sentences[selected] : null;
  const [blurError, setBlurError] = useState<string | null>(null);
  const [shrunk, setShrunk] = useState(false);

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
      accessibilityLabel="Reading Panel"
      style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.separator }]}
    >
      <ScrollView
        style={{ height: SENTENCE_BOX_HEIGHT }}
        onLayout={(e) => {
          // Shrink exactly one step on real overflow; a box that measured at
          // zero (the test host) never shrinks.
          if (!shrunk && shouldShrink(e.nativeEvent.layout.height, SENTENCE_BOX_HEIGHT)) setShrunk(true);
        }}
      >
        {sen ? (
          <View key={selected}>
            <Text style={[styles.panelSentence, { color: colors.label }, shrunk && styles.shrunkSentence]}>
              {sen.tokens.map((tok, j) => (
                <TokenWords key={j} token={tok} />
              ))}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sentence Translation"
              accessibilityHint={blur ? "Tap to show the translation" : "Tap to hide the translation"}
              onPress={() => void toggleBlur()}
              style={styles.translationRow}
            >
              <Text style={[styles.translation, { color: blur ? "transparent" : colors.subtle }]}>{sen.en}</Text>
              {blur ? (
                <View style={[styles.blurOverlay, { backgroundColor: colors.card }]}>
                  <Text style={{ color: colors.subtle, fontSize: 14 }}>Translation hidden — tap to show</Text>
                </View>
              ) : null}
            </Pressable>
            {reading.state.status === "error" ? (
              <Text style={{ color: colors.subtle, fontSize: 13 }}>
                (reading settings unavailable — {reading.state.message})
              </Text>
            ) : null}
          </View>
        ) : (
          <Text style={{ color: colors.subtle }}>Tap a word or punctuation to select its sentence.</Text>
        )}
      </ScrollView>
      {blurError ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          Could not save that — {blurError}
        </Text>
      ) : null}
      <View
        accessibilityLabel="Lookup row"
        style={[styles.lookupRow, { borderTopColor: colors.separator }]}
      >
        {/* Fixed label, outside the conditional content: it keeps its slot so
            the row never shifts as lookups come and go. */}
        <Text style={[styles.lookupLabel, { color: colors.subtle }]}>Word meaning</Text>
        <LookupRow story={story} looked={looked} lookup={lookup} />
      </View>
    </View>
  );
}

/**
 * The single Lookup row line. A word: the word in blue, its reading in
 * orange, the first two glosses ("…" when the entry has more), and on the
 * right the pitch graph then the JLPT badge — all from the cached entry the
 * press triggered, so repeat lookups are instant. A Grammar Span instead
 * shows the Grammar Point's pattern and meaning straight from the story
 * payload — no request needed.
 */
function LookupRow({
  story,
  looked,
  lookup,
}: {
  story: Story;
  looked: LookedTarget | null;
  lookup: EntryLookup;
}) {
  const colors = useColors();
  if (!looked) return <Text style={{ color: colors.subtle, fontSize: 14 }}>Touch a word to look it up.</Text>;
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
  // Until the entry arrives, a story Focus Set item already has a gloss to show.
  const seedGloss = entry ? undefined : story.vocabItems?.find((v) => v.entSeq === token.entSeq)?.en;
  const glosses = entry ? firstGlosses(entry, 2) : seedGloss ? [seedGloss] : [];
  const more = entry ? countGlosses(entry) > glosses.length : false;
  return (
    <View style={styles.lookupContent}>
      <Text style={{ color: "#1a56db", fontSize: 16, fontWeight: "600" }}>{token.surface}</Text>
      {token.reading && token.reading !== token.surface ? (
        <Text style={{ color: "#b45309", fontSize: 15 }}>{token.reading}</Text>
      ) : null}
      {glosses.length > 0 ? (
        <Text style={{ color: colors.label, fontSize: 14 }} numberOfLines={1}>
          {glosses.join(", ")}
          {more ? "…" : ""}
        </Text>
      ) : null}
      <View style={styles.lookupRight}>
        {entry?.pitch ? <PitchGraph pitch={entry.pitch} /> : null}
        {entry?.jlptLevel ? <JlptBadge level={entry.jlptLevel} /> : null}
      </View>
    </View>
  );
}

function GrammarGloss({ span }: { span: StoryGrammarSpan }) {
  const colors = useColors();
  return (
    <View style={styles.lookupContent}>
      <Text style={{ color: "#1a56db", fontSize: 16, fontWeight: "600" }}>{span.pattern}</Text>
      <Text style={{ color: colors.label, fontSize: 14 }} numberOfLines={1}>
        {span.meaning}
      </Text>
      <View style={styles.lookupRight}>{span.jlptLevel ? <JlptBadge level={span.jlptLevel} /> : null}</View>
    </View>
  );
}

export function tokenEntry(
  lookup: EntryLookup,
  token: StoryToken,
): DictionaryEntry | undefined {
  return token.entSeq !== undefined ? lookup.peek(token.entSeq, token.surface, token.reading) : undefined;
}

const styles = StyleSheet.create({
  panel: {
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    overflow: "hidden",
  },
  panelSentence: { fontSize: 18, lineHeight: 28, padding: 12, paddingBottom: 4 },
  shrunkSentence: { fontSize: 15, lineHeight: 23 },
  translationRow: { position: "relative", minHeight: 40, justifyContent: "center" },
  translation: { fontSize: 14, fontStyle: "italic", paddingHorizontal: 12, paddingBottom: 10 },
  blurOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.95,
  },
  lookupRow: {
    minHeight: LOOKUP_ROW_HEIGHT + MIN_TOUCH - 44 + 12,
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
  },
  lookupLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  lookupContent: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  lookupRight: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 },
});
