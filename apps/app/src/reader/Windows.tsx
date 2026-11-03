import type { DictionaryEntry, StoryGrammarSpan } from "@vjt/api-client";
import * as DialogPrimitives from "@rn-primitives/dialog";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "../components/ui/icon";
import { JlptBadge } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";

/**
 * The Dictionary Entry and Grammar Point windows (issue #14): centred cards
 * over a dimmed story, like the web's windows. Opening one leaves the story
 * text visible behind; the reader keeps the tap-selection and the Lookup row
 * while a window is open, and Android Back closes the topmost window.
 *
 * Issue #45 review: the windows are RN Primitives Dialogs, not RN Modal and
 * not hand-rolled layers — WIDE screens get the centred card, narrow ones a
 * bottom sheet (the Reader passes `narrow` from the shell's OVERLAY_BREAKPOINT).
 * The Title passes through Dialog.Title so assistive tech announces the window,
 * and every dismissal path (×, tap-outside, Escape, Android Back) arrives at
 * `onClose` through the Root's onOpenChange.
 */

function WindowCard({
  testID,
  title,
  reading,
  jlpt,
  narrow,
  onClose,
  children,
}: {
  testID: string;
  title: string;
  reading?: string;
  jlpt?: string | null;
  narrow: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          testID={testID}
          accessibilityLabel={testID === "dictionary-window" ? "Dictionary Entry window" : "Grammar Point window"}
          className="bg-card border-border"
          style={StyleSheet.flatten([styles.card, narrow ? styles.cardNarrow : styles.cardWide])}
          // No Description for these windows — the title says it all; this is
          // Radix's documented way to skip the aria-describedby warning.
          aria-describedby={undefined}
        >
          <View style={styles.head}>
            <DialogPrimitives.Title asChild>
              <Text className="text-title-sm text-foreground" style={styles.title}>
                {title}
              </Text>
            </DialogPrimitives.Title>
            {reading && reading !== title ? (
              <Text className="text-body text-muted-foreground">
                {reading}
              </Text>
            ) : null}
            {jlpt ? <JlptBadge level={jlpt} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={styles.close}>
              <Icon name="close" size="md" strokeWidth={2.5} className="text-muted-foreground" />
            </Pressable>
          </View>
          <ScrollView style={styles.body}>{children}</ScrollView>
        </DialogPrimitives.Content>
      </DialogPrimitives.Portal>
    </DialogPrimitives.Root>
  );
}

export function DictionaryWindow({
  entry,
  narrow,
  onClose,
}: {
  entry: DictionaryEntry;
  narrow: boolean;
  onClose: () => void;
}) {
  return (
    <WindowCard
      testID="dictionary-window"
      title={entry.headword}
      reading={entry.reading !== entry.headword ? entry.reading : undefined}
      jlpt={entry.jlptLevel}
      narrow={narrow}
      onClose={onClose}
    >
      {entry.pitch ? (
        <View style={styles.pitchRow}>
          <PitchGraph pitch={entry.pitch} />
          <Text className="text-caption text-muted-foreground">
            {entry.pitch.heiban ? "heiban (flat)" : `downstep after mora ${entry.pitch.downstepAfterMora}`}
            {entry.pitch.tag ? ` — ${entry.pitch.tag}` : ""}
          </Text>
        </View>
      ) : null}
      {entry.senses.map((sense, i) => (
        <View key={i} style={styles.sense}>
          <Text className="text-caption text-muted-foreground">
            {sense.partsOfSpeech.join(", ")}
          </Text>
          {sense.glosses.map((gloss, j) => (
            <Text key={j} className="text-body text-foreground">
              {gloss}
            </Text>
          ))}
        </View>
      ))}
    </WindowCard>
  );
}

export function GrammarWindow({
  span,
  narrow,
  onClose,
}: {
  span: StoryGrammarSpan;
  narrow: boolean;
  onClose: () => void;
}) {
  return (
    <WindowCard testID="grammar-window" title={span.pattern} jlpt={span.jlptLevel} narrow={narrow} onClose={onClose}>
      <Text className="text-body text-foreground" style={styles.senseMeaning}>
        {span.meaning}
      </Text>
    </WindowCard>
  );
}

// The Dialog portals leave positioning entirely to these styles: centred card
// wide, pinned to the bottom edge narrow. fixed on web (the portal lands at
// the end of <body>), absolute inside the native PortalHost.
// Both overlay kinds sit inside the primitives' portal, which on web is a
// full-viewport fixed div — an `absolute` inset fills the viewport there and the
// reader host on native, so one value works on both platforms.
const positioned = { position: "absolute" as const };

const styles = StyleSheet.create({
  backdrop: { ...positioned, top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
  },
  cardWide: {
    ...positioned,
    top: "15%",
    left: "6%",
    right: "6%",
    maxHeight: "70%",
  },
  cardNarrow: {
    ...positioned,
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "80%",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  title: { fontWeight: "600" },
  head: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, flexWrap: "wrap" },
  close: { marginLeft: "auto", width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
  pitchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  sense: { marginBottom: 10 },
  senseMeaning: { marginBottom: 8 },
});
