import type { ItemList } from "@vjt/api-client";
import { X } from "lucide-react-native";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/**
 * The "Save to…" bottom sheet (issue #14): the mobile form of the web's
 * popover. It lists the Learner's Item Lists — the Default List marked —
 * and offers inline list creation, mirroring the web's create-then-save
 * flow: the save only follows a successful create.
 */
export function SaveToSheet({
  lists,
  defaultListId,
  busy,
  error,
  onSaveToList,
  onCreateAndSave,
  onClose,
}: {
  lists: ItemList[];
  defaultListId: string | null;
  busy: boolean;
  error: string | null;
  onSaveToList: (listId: string) => void;
  onCreateAndSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    onCreateAndSave(trimmed);
  };

  return (
    // onRequestClose covers Back inside the Android dialog (the Modal consumes
    // the key press, so the reader's own Back listener never also pops the
    // sheet); the reader keeps its sheetToken branch as a deliberate safety
    // net for when the Modal path is unavailable — see StoryReader.useHardwareBack.
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      {/* KeyboardAvoidingView lifts the sheet — and the inline "New list
          name" TextInput — above the on-screen keyboard (Android padding
          behaviour). Manual checklist: open Save to… with the keyboard up
          on a device and confirm the input and Create button stay visible. */}
      <KeyboardAvoidingView style={styles.backdrop} className="bg-backdrop" behavior="padding">
        <View style={styles.sheet} className="bg-card border-t border-border">
          <View style={styles.head}>
            <Text className="text-foreground" style={styles.title}>
              Save to…
            </Text>
            <Pressable
              testID="sheet-close"
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <X size={20} strokeWidth={2.5} className="text-muted-foreground" />
            </Pressable>
          </View>
          {error ? (
            <Text accessibilityRole="alert" className="text-destructive" style={styles.error}>
              Could not save — {error}
            </Text>
          ) : null}
          <ScrollView style={styles.list}>
            {lists.map((list) => (
              <Pressable
                key={list.id}
                testID={`save-list-${list.id}`}
                accessibilityRole="button"
                disabled={busy}
                onPress={() => onSaveToList(list.id)}
                style={styles.listRow}
                className="border-b border-border"
              >
                <Text className="text-foreground" style={styles.listName}>
                  {list.name}
                </Text>
                {list.id === defaultListId ? <Text className="text-muted-foreground" style={styles.defaultTag}>default</Text> : null}
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.create}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="New list name"
              className="text-foreground placeholder:text-muted-foreground bg-background border border-border"
              style={styles.input}
            />
            <Pressable
              testID="create-list"
              accessibilityRole="button"
              accessibilityLabel="Create a new list and save"
              disabled={busy || !name.trim()}
              onPress={create}
              style={styles.createButton}
              className="bg-primary"
            >
              <Text className="text-primary-foreground" style={styles.createLabel}>
                Create
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8, paddingBottom: 18 },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: "600" },
  close: { marginLeft: "auto", width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  error: { fontSize: 14, marginBottom: 8, paddingHorizontal: 16 },
  list: { maxHeight: 260 },
  listRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  listName: { fontSize: 16 },
  defaultTag: { fontSize: 13 },
  create: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  input: { flex: 1, minHeight: 44, borderRadius: 8, paddingHorizontal: 10, fontSize: 15 },
  createButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  createLabel: { fontSize: 15 },
});
