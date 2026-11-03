import type { DictionaryEntry, StoryGrammarSpan } from "@vjt/api-client";
import { X } from "lucide-react-native";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

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
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} className="bg-backdrop">
        <View
          testID={testID}
          accessibilityLabel={testID === "dictionary-window" ? "Dictionary Entry window" : "Grammar Point window"}
          className="bg-card border-border"
          style={styles.card}
        >
          <View style={styles.head}>
            <Text className="text-foreground" style={{ fontSize: 20, fontWeight: "600" }}>
              {title}
            </Text>
            {reading && reading !== title ? (
              <Text className="text-muted-foreground" style={{ fontSize: 16 }}>
                {reading}
              </Text>
            ) : null}
            {jlpt ? <JlptBadge level={jlpt} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={8} style={styles.close}>
              <X size={20} strokeWidth={2.5} className="text-muted-foreground" />
            </Pressable>
          </View>
          <ScrollView style={styles.body}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  );
}

export function DictionaryWindow({ entry, onClose }: { entry: DictionaryEntry; onClose: () => void }) {
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
          <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
            {entry.pitch.heiban ? "heiban (flat)" : `downstep after mora ${entry.pitch.downstepAfterMora}`}
            {entry.pitch.tag ? ` — ${entry.pitch.tag}` : ""}
          </Text>
        </View>
      ) : null}
      {entry.senses.map((sense, i) => (
        <View key={i} style={styles.sense}>
          <Text className="text-muted-foreground" style={{ fontSize: 13 }}>
            {sense.partsOfSpeech.join(", ")}
          </Text>
          {sense.glosses.map((gloss, j) => (
            <Text key={j} className="text-foreground" style={{ fontSize: 16 }}>
              {gloss}
            </Text>
          ))}
        </View>
      ))}
    </WindowCard>
  );
}

export function GrammarWindow({ span, onClose }: { span: StoryGrammarSpan; onClose: () => void }) {
  return (
    <WindowCard testID="grammar-window" title={span.pattern} jlpt={span.jlptLevel} onClose={onClose}>
      <Text className="text-foreground" style={styles.senseMeaning}>
        {span.meaning}
      </Text>
    </WindowCard>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: {
    width: "88%",
    maxHeight: "70%",
    borderRadius: 12,
    borderWidth: 1,
    elevation: 8,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8, padding: 14, flexWrap: "wrap" },
  close: { marginLeft: "auto", width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  body: { paddingHorizontal: 14, paddingBottom: 14 },
  pitchRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  sense: { marginBottom: 10 },
  senseMeaning: { fontSize: 16, marginBottom: 8 },
});
