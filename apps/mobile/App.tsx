import { createApiClient } from "@vjt/api-client";
import { useHealth } from "@vjt/core";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";

import { resolveApiBaseUrl } from "./src/config.ts";

// Expo only inlines literal `process.env.EXPO_PUBLIC_*` references.
const client = createApiClient({
  baseUrl: resolveApiBaseUrl({ EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL }),
});

export default function App() {
  const health = useHealth(client);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Virtual Japan Tutor</Text>
      {health.state === "loading" && <Text>Checking server…</Text>}
      {(health.state === "ok" || health.state === "degraded") && (
        <Text>
          Server: {health.health.status}, database: {health.health.database}
        </Text>
      )}
      {health.state === "error" && <Text>Cannot reach server: {health.message}</Text>}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 12 },
});
