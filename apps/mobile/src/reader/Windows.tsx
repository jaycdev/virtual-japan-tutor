import type { DictionaryEntry, StoryGrammarSpan } from "@vjt/api-client";
import { type RubyText, sensePartOfSpeechLabels, type StringKey, useT } from "@vjt/core";
import * as DialogPrimitives from "@rn-primitives/dialog";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "../components/ui/icon";
import { TableText } from "../components/Text.tsx";
import { useSheetBottomInset } from "../components/ui/sheet.ts";
import { JlptBadge, SrsLevelText } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";

/** The pitch spelled out, with Kanjium's own tag last: the graph's caption. */
function pitchCaptionSegments(t: ReturnType<typeof useT>["t"], pitch: NonNullable<DictionaryEntry["pitch"]>): RubyText {
  const base = pitch.heiban ? t("reader.pitchHeiban") : t("reader.pitchDownstep", { n: pitch.downstepAfterMora });
  return pitch.tag ? [...base, { text: ` — ${pitch.tag}` }] : base;
}

/**
 * The Dictionary Entry and Grammar Point windows (issue #14): bottom sheets over
 * a dimmed story. Opening one leaves the story text visible behind; the reader
 * keeps the tap-selection and the Lookup row while a window is open, and
 * Android Back closes the topmost window.
 *
 * The windows are RN Primitives Dialogs (issue #45 review), always pinned to the
 * bottom edge on the phone. The Title passes through Dialog.Title so assistive
 * tech announces the window, and every dismissal path (×, tap-outside, Back)
 * arrives at `onClose` through the Root's onOpenChange.
 */

function WindowCard({
  testID,
  ariaKey,
  title,
  reading,
  jlpt,
  srs,
  onClose,
  children,
}: {
  testID: string;
  /** Names the window for assistive tech, from the string table. */
  ariaKey: StringKey;
  title: string;
  reading?: string;
  jlpt?: string | null;
  srs?: number | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const inset = useSheetBottomInset();
  const { tp } = useT();
  return (
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          testID={testID}
          accessibilityLabel={tp(ariaKey)}
          className="bg-card border-border"
          style={StyleSheet.flatten([styles.card, styles.sheet, { paddingBottom: inset }])}
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
            {srs != null ? <SrsLevelText level={srs} /> : null}
            {jlpt ? <JlptBadge level={jlpt} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={tp("common.close")} onPress={onClose} hitSlop={8} style={styles.close}>
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
  onClose,
}: {
  entry: DictionaryEntry;
  onClose: () => void;
}) {
  const { t } = useT();
  // Each sense's Part of Speech (issue #132), with a repeat of the sense above left out.
  const partsOfSpeech = sensePartOfSpeechLabels(entry.senses, t);
  return (
    <WindowCard
      testID="dictionary-window"
      ariaKey="mobile.readerDictWindowAria"
      title={entry.headword}
      reading={entry.reading !== entry.headword ? entry.reading : undefined}
      jlpt={entry.jlptLevel}
      srs={entry.srsLevel}
      onClose={onClose}
    >
      {entry.pitch ? (
        <View style={styles.pitchRow}>
          <PitchGraph pitch={entry.pitch} />
          <TableText
            className="text-caption text-muted-foreground"
            segments={pitchCaptionSegments(t, entry.pitch)}
          />
        </View>
      ) : null}
      {entry.senses.map((sense, i) => (
        <View key={i} style={styles.sense}>
          {partsOfSpeech[i] ? (
            <TableText className="text-caption text-muted-foreground" segments={partsOfSpeech[i]} />
          ) : null}
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
  onClose,
}: {
  span: StoryGrammarSpan;
  onClose: () => void;
}) {
  return (
    <WindowCard testID="grammar-window" ariaKey="mobile.readerGrammarWindowAria" title={span.pattern} jlpt={span.jlptLevel} srs={span.srsLevel} onClose={onClose}>
      <Text className="text-body text-foreground" style={styles.senseMeaning}>
        {span.meaning}
      </Text>
    </WindowCard>
  );
}

// The Dialog portals are positioned entirely by these styles: an `absolute`
// inset inside the Shell's PortalHost.
const positioned = { position: "absolute" as const };

const styles = StyleSheet.create({
  backdrop: { ...positioned, top: 0, left: 0, right: 0, bottom: 0 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
  },
  sheet: {
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
