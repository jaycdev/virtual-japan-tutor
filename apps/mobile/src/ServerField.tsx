// The server-address editor (#11), shared by two entry points:
// - Login shows it (the app has no same-origin address to infer);
// - the AuthGate error card shows it too (#51 review B1): a
//   Learner who lands on an unreachable address must never be trapped.
//
// Android cannot infer a host: the Learner points the app at the LAN server
// here. Hidden behind one quiet line so first-run stays a login form.
// The strings are the screen's own (#125): the shape error is kept as a key
// so its furigana survives, and only the thrown Error's message arrives as a
// pre-localized plain string.
import { useT, type EntryRef } from "@vjt/core";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { T } from "./components/Text.tsx";
import { normalizeServerUrl } from "./config.ts";

export function ServerField({
  serverUrl,
  onSave,
}: {
  serverUrl: string;
  onSave: (url: string) => Promise<void>;
}) {
  const { tp } = useT();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(serverUrl);
  const [busy, setBusy] = useState(false);
  // A table-backed failure stays a string-table entry ({ k, params }) so the
  // text follows the Interface Language however long the note sits here; only
  // the server's own message arrives pre-resolved.
  const [error, setError] = useState<EntryRef | string | undefined>();

  const save = async () => {
    const next = normalizeServerUrl(url);
    if (!next) {
      setError({ k: "mobile.serverUrlShape" });
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : { k: "mobile.serverSaveFailed" });
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <View className="gap-1">
        <T k="mobile.serverLine" params={{ url: serverUrl }} className="text-caption text-muted-foreground" />
        <Pressable
          className="min-h-11 justify-center"
          accessibilityRole="button"
          accessibilityLabel={tp("mobile.changeServer")}
          onPress={() => {
            setUrl(serverUrl);
            setError(undefined);
            setEditing(true);
          }}
        >
          <T k="mobile.changeServer" className="text-small text-primary" />
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <T k="server.addressLabel" className="text-small text-muted-foreground" />
        <TextInput
          className="min-h-11 rounded-lg border border-input bg-background px-3 text-body text-foreground"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={tp("server.addressLabel")}
          editable={!busy}
        />
      </View>
      {error ? (
        typeof error === "string" ? (
          <Text className="text-small text-destructive">{error}</Text>
        ) : (
          <T k={error.k} params={error.params} className="text-small text-destructive" />
        )
      ) : null}
      <View className="flex-row gap-3">
        <Pressable
          className="min-h-11 flex-1 items-center justify-center rounded-lg bg-primary disabled:opacity-50"
          accessibilityRole="button"
          accessibilityLabel={tp("mobile.saveServer")}
          disabled={busy}
          onPress={() => void save()}
        >
          <T k="mobile.saveServer" className="text-small font-semibold text-primary-foreground" />
        </Pressable>
        <Pressable
          className="min-h-11 flex-1 items-center justify-center rounded-lg border border-input"
          accessibilityRole="button"
          accessibilityLabel={tp("common.cancel")}
          onPress={() => setEditing(false)}
        >
          <T k="common.cancel" className="text-small text-foreground" />
        </Pressable>
      </View>
    </View>
  );
}
