import type { ItemList } from "@vjt/api-client";
import { Icon } from "../components/ui/icon";
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
 * Modal, pinned to the bottom edge on the phone. ×, tap-outside and Android
 * Back all arrive at `onClose` through the Root.
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
    <DialogPrimitives.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitives.Portal>
        <DialogPrimitives.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitives.Content
          style={styles.sheet}
          className="bg-card border-t border-border"
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
                <Text className="text-title-sm text-foreground" style={styles.title}>
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
                <Icon name="close" size="md" strokeWidth={2.5} className="text-muted-foreground" />
              </Pressable>
            </View>
            <DialogPrimitives.Description asChild>
              <Text className="text-caption text-muted-foreground" style={styles.subtitle}>
                Save the word or pattern to one of your lists.
              </Text>
            </DialogPrimitives.Description>
            {error ? (
              <Text accessibilityRole="alert" className="text-small text-destructive" style={styles.error}>
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
                  <Text className="text-body text-foreground">
                    {list.name}
                  </Text>
                  {list.id === defaultListId ? <Text className="text-caption text-muted-foreground">default</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
            <View style={styles.create}>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="New list name"
                className="text-body text-foreground placeholder:text-muted-foreground bg-background border border-border"
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
                <Text className="text-body text-primary-foreground">
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

// The Dialog portals are positioned entirely by these styles: an `absolute`
// inset inside the Shell's PortalHost, pinned to the bottom edge.
const positioned = { position: "absolute" as const };

const styles = StyleSheet.create({
  backdrop: { ...positioned, top: 0, left: 0, right: 0, bottom: 0 },
  // the sheet's own box: it grows with the keyboard padding the view adds
  avoider: { paddingBottom: 0 },
  sheet: {
    ...positioned,
    elevation: 12,
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingBottom: 18,
  },
  head: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 8 },
  title: { fontWeight: "600" },
  close: { marginLeft: "auto", width: 22, height: 22, alignItems: "center", justifyContent: "center" },
  subtitle: { marginBottom: 8, paddingHorizontal: 16 },
  error: { marginBottom: 8, paddingHorizontal: 16 },
  list: { maxHeight: 260 },
  listRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  create: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  input: { flex: 1, minHeight: 44, borderRadius: 8, paddingHorizontal: 10 },
  createButton: {
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
