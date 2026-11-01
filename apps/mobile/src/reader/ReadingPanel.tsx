import type { Story, StoryGrammarSpan } from "@vjt/api-client";
import type { ReadingSettingsView } from "@vjt/core";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "../theme.ts";
import { coveringSpan, shouldShrink } from "./holdMenu.ts";
import { countGlosses, firstGlosses, JlptBadge } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";
import { TokenWords } from "./StoryText.tsx";
import type { EntryLookup } from "./useEntryLookup.ts";

/**
 * The Reading Panel (issue #14): ONE fixed-size area above the story that
 * never moves as the story scrolls, and never resizes as lookups come and go.
 * It SWITCHES between two modes inside that single box (the mobile ticket is
 * explicit — the web two-row layout is wrong here):
 *
 *   sentence-mode (idle): the selected sentence (with furigana) and its
 *     Sentence Translation — long text first shrinks one step, then scrolls
 *     inside its half of the box;
 *   word-mode (while a token is pressed/held): the Lookup line for the
 *     pressed word or Grammar Span, in the same box.
 *
 * The shrink is decided from the sentence's *content* height (RN fires
 * onContentSizeChange when the text changes size; onLayout of a fixed-height
 * ScrollView only ever reports the box, which is why it cannot detect
 * overflow), and it is re-decided whenever the selected sentence changes.
 *
 * Android has no CSS blur, so the blurred Sentence Translation is rendered
 * as transparent text with an opaque "hidden" overlay over it: same tap to
 * reveal, same layout, nothing readable to a screen reader either.
 */

const SENTENCE_BOX_HEIGHT = 96;
const PANEL_HEIGHT = 148;

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
  sentenceContentHeight,
}: {
  story: Story;
  selected: number | null;
  looked: LookedTarget | null;
  reading: ReadingSettingsView;
  lookup: EntryLookup;
  /** Reports Weak Signals when a blurred Sentence Translation is revealed. */
  onUnblur: (sentenceIdx: number) => void;
  /** Injects the measured sentence height (jsdom never fires onContentSizeChange). */
  sentenceContentHeight?: number;
}) {
  const colors = useColors();
  const blur = reading.state.status === "ready" ? reading.state.settings.blurTranslation : true;
  const sen = selected !== null ? story.sentences[selected] : null;
  const [blurError, setBlurError] = useState<string | null>(null);
  const [shrunkFor, setShrunkFor] = useState<number | null>(null);
  const shrunk = selected !== null && shrunkFor === selected;

  // The shrink belongs to the sentence that overflowed: selecting another
  // sentence resets it, and that sentence's own content measurement decides
  // again (the web reader does the same per sentence). Both adjustments
  // happen during render — React's pattern for state derived from a prop
  // change — guarded by equality checks so each one runs exactly once.
  const [prevSelected, setPrevSelected] = useState(selected);
  if (prevSelected !== selected) {
    setPrevSelected(selected);
    setShrunkFor(null);
  }
  const [measuredHeight, setMeasuredHeight] = useState<number | undefined>(undefined);
  if (measuredHeight !== sentenceContentHeight) {
    setMeasuredHeight(sentenceContentHeight);
    if (selected !== null && sentenceContentHeight !== undefined && shouldShrink(sentenceContentHeight, SENTENCE_BOX_HEIGHT)) {
      setShrunkFor(selected);
    }
  }

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
      testID="reading-panel"
      accessibilityLabel="Reading Panel"
      style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.separator }]}
    >
      {looked ? (
        <View accessibilityLabel="Lookup row" style={styles.wordMode}>
          {/* Fixed label, outside the conditional content: it keeps its slot
              so the box never shifts as lookups come and go. */}
          <Text style={[styles.lookupLabel, { color: colors.subtle }]}>Word meaning</Text>
          <LookupRow story={story} looked={looked} lookup={lookup} />
        </View>
      ) : (
        <>
          <ScrollView
            style={{ height: SENTENCE_BOX_HEIGHT }}
            onContentSizeChange={(_w, h) => {
              // Shrink exactly one step on real overflow (the host measures
              // the text inside the fixed box). A height of zero — a layout
              // that has not settled — never shrinks.
              if (selected !== null && shouldShrink(h, SENTENCE_BOX_HEIGHT)) setShrunkFor(selected);
            }}
          >
            {sen ? (
              <View key={selected}>
                <Text testID="panel-sentence" style={[styles.panelSentence, { color: colors.label }, shrunk && styles.shrunkSentence]}>
                  {sen.tokens.map((tok, j) => (
                    <TokenWords key={j} token={tok} />
                  ))}
                </Text>
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
          {sen ? (
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
          ) : null}
          {blurError ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
              Could not save that — {blurError}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * The word-mode Lookup line. A word: the word in blue, its reading in
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

const styles = StyleSheet.create({
  panel: {
    // One fixed size for both modes: lookups and long sentences can never
    // resize the panel, so the story below it never shifts.
    height: PANEL_HEIGHT,
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    overflow: "hidden",
  },
  wordMode: {
    height: PANEL_HEIGHT - 2, // inside the 1dp border
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  panelSentence: { fontSize: 18, lineHeight: 28, padding: 12, paddingBottom: 4 },
  shrunkSentence: { fontSize: 15, lineHeight: 23 },
  translationRow: { position: "relative", flex: 1, justifyContent: "center" },
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
  lookupLabel: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.4 },
  lookupContent: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  lookupRight: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 8 },
});
