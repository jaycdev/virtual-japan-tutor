// Login: the signed-out screen. Same auth contract as before (#13): the
// Learner types Username / Password, presses "Log in", and Android can point
// the app at a different server address; on web the address comes from the
// page origin. This component owns presentation only — the auth machine lives
// in AuthGate, and a login attempt is handed up via onLogin.
import { useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ServerField } from "./ServerField.tsx";

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

        <ServerField serverUrl={serverUrl} onSave={onSaveServerUrl} />
      </View>
    </ScrollView>
  );
}
