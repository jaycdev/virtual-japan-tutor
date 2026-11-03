import type { ItemList } from "@vjt/api-client";
import { X } from "lucide-react-native";
import * as DialogPrimitives from "@rn-primitives/dialog";
import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

/**
 * The "Save to…" sheet (issue #14): the mobile form of the web's popover. It
 * lists the Learner's Item Lists — the Default List marked — and offers
 * inline list creation, mirroring the web's create-then-save flow: the save
 * only follows a successful create.
 *
 * Issue #45 review: it is an RN Primitives Dialog like the windows, not an RN
 * Modal — bottom sheet on narrow screens, centred card on wide ones (the
 * Reader passes `narrow` from the shell's OVERLAY_BREAKPOINT). ×, tap-outside,
 * Escape and Android Back all arrive at `onClose` through the Root.
 */
export function SaveToSheet({
  lists,
  defaultListId,
  busy,
  error,
  narrow,
  onSaveToList,
  onCreateAndSave,
  onClose,
}: {
  lists: ItemList[];
  defaultListId: string | null;
  busy: boolean;
  error: string | null;
  narrow: boolean;
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
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          style={[styles.sheet, narrow ? styles.sheetNarrow : styles.sheetWide]}
          className={narrow ? "bg-card border-t border-border" : "bg-card border border-border"}
        >
          {/* The Dialog leaves the soft keyboard to the platform (Android
              resize), but the manual checklist still wants the inline "New list
              name" TextInput clear of the keyboard, so the avoiding view keeps
              it lifted inside the sheet. It sits inside the Content: the
              primitives' enter/exit transition needs the Content to be the
              Portal's direct child. */}
          <KeyboardAvoidingView
            style={styles.avoider}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={styles.head}>
              <DialogPrimitives.Title asChild>
                <Text className="text-foreground" style={styles.title}>
                  Save to…
                </Text>
              </DialogPrimitives.Title>
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
            <DialogPrimitives.Description asChild>
              <Text className="text-muted-foreground" style={styles.subtitle}>
                Save the word or pattern to one of your lists.
              </Text>
            </DialogPrimitives.Description>
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
          </KeyboardAvoidingView>
        </DialogPrimitives.Content>
      </DialogPrimitives.Portal>
    </DialogPrimitives.Root>
  );
}

// The Dialog portals leave positioning entirely to these styles: bottom sheet
// narrow, centred card wide (fixed on web, where the portal lands at the end
// of <body>; absolute inside the native PortalHost).
// The sheet renders inside the primitives' portal, whose web wrapper is a
// full-viewport fixed div, so `absolute` fills the screen there and the reader
// host on native.
const positioned = { position: "absolute" as const };

const styles = StyleSheet.create({
  backdrop: { ...positioned, top: 0, left: 0, right: 0, bottom: 0 },
  // the sheet's own box: it grows with the keyboard padding the view adds
  avoider: { paddingBottom: 0 },
  sheet: { elevation: 12 },
  sheetNarrow: {
    ...positioned,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 18,
  },
  sheetWide: {
    ...positioned,
    top: "15%",
    left: "25%",
    right: "25%",
    maxHeight: "70%",
    paddingTop: 12,
    paddingBottom: 18,
  },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: "600" },
  close: { marginLeft: "auto", width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  subtitle: { fontSize: 13, marginBottom: 8, paddingHorizontal: 16 },
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
