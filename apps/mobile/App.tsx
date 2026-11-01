import { createApiClient } from "@vjt/api-client";
import { useAuth, useHealth, type Auth } from "@vjt/core";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, StyleSheet, Text, TextInput, View } from "react-native";

import { resolveApiBaseUrl } from "./src/config.ts";
import { secureStoreTokenStorage } from "./src/tokenStorage.ts";

// Created once at module level: useAuth requires stable client/storage references.
// Expo only inlines literal `process.env.EXPO_PUBLIC_*` references.
const client = createApiClient({
  baseUrl: resolveApiBaseUrl({ EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL }),
});
const storage = secureStoreTokenStorage(SecureStore);

export default function App() {
  const auth = useAuth(client, storage);
  const { state } = auth;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Virtual Japan Tutor</Text>
      {state.status === "loading" && <Text>Loading…</Text>}
      {state.status === "error" && (
        <>
          <Text>Cannot reach server: {state.message}</Text>
          <Button title="Retry" onPress={auth.retry} />
        </>
      )}
      {state.status === "signedOut" && <LoginForm auth={auth} error={state.error} />}
      {state.status === "signedIn" && (
        <Shell username={state.user.username} onLogout={auth.logout} />
      )}
      <StatusBar style="auto" />
    </View>
  );
}

function LoginForm({ auth, error }: { auth: Auth; error: string | undefined }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  return (
    <View style={styles.form}>
      <TextInput
        style={styles.input}
        placeholder="Username"
        accessibilityLabel="Username"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        value={username}
        onChangeText={setUsername}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        accessibilityLabel="Password"
        secureTextEntry
        autoCapitalize="none"
        autoComplete="current-password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={() => void auth.login(username, password)}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Button
        title="Log in"
        disabled={auth.busy || !username || !password}
        onPress={() => void auth.login(username, password)}
      />
    </View>
  );
}

function Shell({ username, onLogout }: { username: string; onLogout: () => Promise<void> }) {
  const health = useHealth(client);

  return (
    <View style={styles.form}>
      <Text>Signed in as {username}</Text>
      {health.state === "loading" && <Text>Checking server…</Text>}
      {(health.state === "ok" || health.state === "degraded") && (
        <Text>
          Server: {health.health.status}, database: {health.health.database}
        </Text>
      )}
      {health.state === "error" && <Text>Cannot reach server: {health.message}</Text>}
      <Button title="Log out" onPress={() => void onLogout()} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 12 },
  form: { width: "80%", gap: 12 },
  input: { borderWidth: 1, borderColor: "#999", borderRadius: 4, padding: 8 },
  error: { color: "#b00020" },
});
