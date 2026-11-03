import type { DictionaryEntry, StoryGrammarSpan } from "@vjt/api-client";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { MIN_TOUCH, useColors } from "../theme.ts";
import { JlptBadge } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";

/**
 * The Dictionary Entry and Grammar Point windows (issue #14): centred cards
 * over a dimmed story, like the web's windows. Opening one leaves the story
 * text visible behind; the reader keeps the tap-selection and the Lookup row
 * while a window is open, and Android Back closes the topmost window.
 */

function WindowCard({
  testID,
  title,
  reading,
  jlpt,
  onClose,
  children,
}: {
  testID: string;
  title: string;
  reading?: string;
  jlpt?: string | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View
          testID={testID}
          accessibilityLabel={testID === "dictionary-window" ? "Dictionary Entry window" : "Grammar Point window"}
          style={[styles.card, { backgroundColor: colors.card, borderColor: colors.separator }]}
        >
          <View style={styles.head}>
            <Text style={{ color: colors.label, fontSize: 20, fontWeight: "600" }}>{title}</Text>
            {reading && reading !== title ? <Text style={{ color: colors.subtle, fontSize: 16 }}>{reading}</Text> : null}
            {jlpt ? <JlptBadge level={jlpt} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <Text style={{ color: colors.subtle, fontSize: 18, fontWeight: "600" }}>×</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.body}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function DictionaryWindow({ entry, onClose }: { entry: DictionaryEntry; onClose: () => void }) {
  const colors = useColors();
  return (
    <WindowCard
      testID="dictionary-window"
      title={entry.headword}
      reading={entry.reading !== entry.headword ? entry.reading : undefined}
      jlpt={entry.jlptLevel}
      onClose={onClose}
    >
      {entry.pitch ? (
        <View style={styles.pitchRow}>
          <PitchGraph pitch={entry.pitch} />
          <Text style={{ color: colors.subtle, fontSize: 13 }}>
            {entry.pitch.heiban ? "heiban (flat)" : `downstep after mora ${entry.pitch.downstepAfterMora}`}
            {entry.pitch.tag ? ` — ${entry.pitch.tag}` : ""}
          </Text>
        </View>
      ) : null}
      {entry.senses.map((sense, i) => (
        <View key={i} style={styles.sense}>
          <Text style={{ color: colors.subtle, fontSize: 13 }}>{sense.partsOfSpeech.join(", ")}</Text>
          {sense.glosses.map((gloss, j) => (
            <Text key={j} style={{ color: colors.label, fontSize: 16 }}>
              {gloss}
            </Text>
          ))}
        </View>
      ))}
    </WindowCard>
  );
}

export function GrammarWindow({ span, onClose }: { span: StoryGrammarSpan; onClose: () => void }) {
  const colors = useColors();
  return (
    <WindowCard testID="grammar-window" title={span.pattern} jlpt={span.jlptLevel} onClose={onClose}>
      <Text style={[styles.senseMeaning, { color: colors.label }]}>{span.meaning}</Text>
    </WindowCard>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  card: {
    width: "88%",
    maxHeight: "70%",
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, flexWrap: "wrap" },
  close: { marginLeft: "auto", width: MIN_TOUCH / 2, height: MIN_TOUCH / 2, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
  pitchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  sense: { marginBottom: 10 },
  senseMeaning: { fontSize: 16, marginBottom: 8 },
});
