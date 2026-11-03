// Login: the signed-out screen. Same auth contract as before (#13): the
// Learner types Username / Password, presses "Log in", and Android can point
// the app at a different server address; on web the address comes from the
// page origin. This component owns presentation only — the auth machine lives
// in AuthGate, and a login attempt is handed up via onLogin.
import { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { normalizeServerUrl } from "./config.ts";

export interface LoginProps {
  busy: boolean;
  error: string | undefined;
  serverUrl: string;
  onLogin: (username: string, password: string) => void;
  onSaveServerUrl: (url: string) => Promise<void>;
}

export function Login({ busy, error, serverUrl, onLogin, onSaveServerUrl }: LoginProps) {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = () => {
    if (busy || !username || !password) return;
    onLogin(username, password);
  };

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{
        flexGrow: 1,
        justifyContent: "center",
        alignItems: "center",
        padding: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View className="w-full max-w-[380px] gap-6 rounded-2xl bg-card p-6 shadow-md">
        <View className="items-center gap-1">
          <Text className="text-display font-serif text-primary" allowFontScaling={false}>
            読
          </Text>
          <Text className="text-title-sm font-semibold text-foreground">Virtual Japan Tutor</Text>
        </View>

        <View className="gap-4">
          <View className="gap-1.5">
            <Text className="text-small text-muted-foreground">Username</Text>
            <TextInput
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-body text-foreground"
              value={username}
              onChangeText={setUsername}
              onSubmitEditing={submit}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              accessibilityLabel="Username"
              editable={!busy}
            />
          </View>
          <View className="gap-1.5">
            <Text className="text-small text-muted-foreground">Password</Text>
            <TextInput
              className="min-h-11 rounded-lg border border-input bg-background px-3 text-body text-foreground"
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={submit}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              secureTextEntry
              accessibilityLabel="Password"
              editable={!busy}
            />
          </View>
        </View>

        {error ? (
          <Text className="text-small text-destructive" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Pressable
          className="min-h-12 items-center justify-center rounded-lg bg-primary disabled:opacity-50"
          accessibilityRole="button"
          accessibilityLabel="Log in"
          disabled={busy || !username || !password}
          onPress={submit}
        >
          <Text className="text-body font-semibold text-primary-foreground">
            {busy ? "Logging in…" : "Log in"}
          </Text>
        </Pressable>

        {Platform.OS === "android" ? <ServerField serverUrl={serverUrl} onSave={onSaveServerUrl} /> : null}
      </View>
    </ScrollView>
  );
}

/**
 * Android cannot infer a host: the Learner points the app at the LAN server
 * here. Hidden behind one quiet line so first-run stays a login form.
 */
function ServerField({ serverUrl, onSave }: { serverUrl: string; onSave: (url: string) => Promise<void> }) {
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
