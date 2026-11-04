// The server-address editor (#11), shared by two entry points:
// - Login shows it (the app has no same-origin address to infer);
// - the AuthGate error card shows it too (#51 review B1): a
//   Learner who lands on an unreachable address must never be trapped.
//
// Android cannot infer a host: the Learner points the app at the LAN server
// here. Hidden behind one quiet line so first-run stays a login form.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { normalizeServerUrl } from "./config.ts";

export function ServerField({
  serverUrl,
  onSave,
}: {
  serverUrl: string;
  onSave: (url: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(serverUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const save = async () => {
    const next = normalizeServerUrl(url);
    if (!next) {
      setError("Enter the full address, like http://192.168.1.10:8080");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the address");
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <View className="gap-1">
        <Text className="text-caption text-muted-foreground">Server: {serverUrl}</Text>
        <Pressable
          className="min-h-11 justify-center"
          accessibilityRole="button"
          accessibilityLabel="Change server"
          onPress={() => {
            setUrl(serverUrl);
            setError(undefined);
            setEditing(true);
          }}
        >
          <Text className="text-small text-primary">Change server</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="gap-3">
      <View className="gap-1.5">
        <Text className="text-small text-muted-foreground">Server address</Text>
        <TextInput
          className="min-h-11 rounded-lg border border-input bg-background px-3 text-body text-foreground"
          value={url}
          onChangeText={setUrl}
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Server address"
          editable={!busy}
        />
      </View>
      {error ? <Text className="text-small text-destructive">{error}</Text> : null}
      <View className="flex-row gap-3">
        <Pressable
          className="min-h-11 flex-1 items-center justify-center rounded-lg bg-primary disabled:opacity-50"
          accessibilityRole="button"
          accessibilityLabel="Save server"
          disabled={busy}
          onPress={() => void save()}
        >
          <Text className="text-small font-semibold text-primary-foreground">Save server</Text>
        </Pressable>
        <Pressable
          className="min-h-11 flex-1 items-center justify-center rounded-lg border border-input"
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          onPress={() => setEditing(false)}
        >
          <Text className="text-small text-foreground">Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}
