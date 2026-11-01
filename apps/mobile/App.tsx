import { createApiClient, type ApiClient } from "@vjt/api-client";
import { useAuth, type Auth, type TokenStorage } from "@vjt/core";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";

import { normalizeServerUrl, resolveApiBaseUrl } from "./src/config.ts";
import { Practice } from "./src/Practice.tsx";
import { secureStoreServerUrl, type ServerUrlStorage } from "./src/serverUrlStorage.ts";
import { SettingsHome } from "./src/SettingsHome.tsx";
import { MIN_TOUCH, useColors } from "./src/theme.ts";
import { secureStoreTokenStorage } from "./src/tokenStorage.ts";
import { ErrorText, Field, LinkButton, Muted, PrimaryButton, Screen, Scroll, Title } from "./src/ui.tsx";

/**
 * Virtual Japan Tutor on Android (issue #13): Login → Practice | Settings.
 *
 * Navigation is state-driven (bottom tab state plus a Settings section
 * state), mirroring the web App's conditional rendering — no router
 * dependency, every screen reachable from tests. The server address loads
 * from the secure store before anything else; `key={serverUrl}` rebuilds the
 * API client (openapi-fetch cannot change a client's base URL) and re-runs
 * session restoration whenever the Learner edits it in Settings → Server.
 */

export default function App() {
  return (
    <Root
      tokenStorage={secureStoreTokenStorage(SecureStore)}
      urlStorage={secureStoreServerUrl(SecureStore)}
    />
  );
}

/**
 * The whole app under a given storage pair, so tests substitute fakes for the
 * native secure store (and a stateful fake `fetch` for the API) without any
 * module mocking. `App` above is only the production wiring.
 */
export function Root({
  tokenStorage,
  urlStorage,
  fetchOverride,
}: {
  tokenStorage: TokenStorage;
  urlStorage: ServerUrlStorage;
  fetchOverride?: typeof globalThis.fetch;
}) {
  // Hydrate the server URL first: everything below (client, auth) is built on it.
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void urlStorage.get().then((stored) => {
      if (cancelled) return;
      setServerUrl(resolveApiBaseUrl({ EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL }, stored));
    });
    return () => {
      cancelled = true;
    };
  }, [urlStorage]);

  if (!serverUrl) return null;

  const changeServerUrl = async (url: string) => {
    await urlStorage.set(url);
    setServerUrl(url);
  };

  return (
    <SafeAreaProvider>
      <Workspace
        key={serverUrl}
        serverUrl={serverUrl}
        tokenStorage={tokenStorage}
        fetchOverride={fetchOverride}
        onChangeServerUrl={changeServerUrl}
      />
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

function Workspace({
  serverUrl,
  tokenStorage,
  fetchOverride,
  onChangeServerUrl,
}: {
  serverUrl: string;
  tokenStorage: TokenStorage;
  fetchOverride?: typeof globalThis.fetch;
  onChangeServerUrl: (url: string) => Promise<void>;
}) {
  // One client per server address, stable across renders (useAuth requires it).
  const client = useMemo(
    () => createApiClient({ baseUrl: serverUrl, ...(fetchOverride ? { fetch: fetchOverride } : {}) }),
    [serverUrl, fetchOverride],
  );
  const auth = useAuth(client, tokenStorage);

  if (auth.state.status === "loading") {
    return (
      <Screen>
        <View style={styles.center}>
          <Muted text="Loading…" />
        </View>
      </Screen>
    );
  }
  if (auth.state.status === "error") {
    return (
      <Screen>
        <Scroll>
          <Title text="Virtual Japan Tutor" />
          <ErrorText text={`Cannot reach the server: ${auth.state.message}`} />
          <Muted text={`Server address: ${serverUrl}`} />
          <PrimaryButton label="Retry" onPress={auth.retry} />
          <ChangeServer serverUrl={serverUrl} onSave={onChangeServerUrl} note="Change the server address" />
        </Scroll>
      </Screen>
    );
  }
  if (auth.state.status === "signedOut") {
    return (
      <Screen>
        <Scroll>
          <Title text="Virtual Japan Tutor" />
          <LoginForm auth={auth} error={auth.state.error} />
          <ChangeServer serverUrl={serverUrl} onSave={onChangeServerUrl} note="Change server" />
        </Scroll>
      </Screen>
    );
  }
  return (
    <Shell
      client={client}
      username={auth.state.user.username}
      serverUrl={serverUrl}
      onLogout={() => void auth.logout()}
      onChangeServerUrl={onChangeServerUrl}
    />
  );
}

function LoginForm({ auth, error }: { auth: Auth; error: string | undefined }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = () => {
    if (auth.busy || !username || !password) return;
    void auth.login(username, password);
  };

  return (
    <>
      <Field
        label="Username"
        value={username}
        onChangeText={setUsername}
        onSubmit={submit}
        autoFocus
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        onSubmit={submit}
        secure
      />
      {error ? <ErrorText text={error} /> : null}
      <PrimaryButton label="Log in" onPress={submit} disabled={auth.busy || !username || !password} />
    </>
  );
}

/** Inline editor for the server address (login screen, unreachable screen). */
function ChangeServer({
  serverUrl,
  onSave,
  note,
}: {
  serverUrl: string;
  onSave: (url: string) => Promise<void>;
  note: string;
}) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(serverUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (!editing) {
    return (
      <>
        <Muted text={`Server: ${serverUrl}`} />
        <LinkButton label={note} onPress={() => { setUrl(serverUrl); setError(undefined); setEditing(true); }} />
      </>
    );
  }
  return (
    <>
      <Field
        label="Server address"
        value={url}
        onChangeText={setUrl}
        keyboardType="url"
        disabled={busy}
      />
      {error ? <ErrorText text={error} /> : null}
      <PrimaryButton
        label="Save server"
        onPress={() => {
          const next = normalizeServerUrl(url);
          if (!next) {
            setError("Enter the full address, like http://192.168.1.10:8080");
            return;
          }
          setBusy(true);
          void onSave(next).finally(() => {
            setBusy(false);
            setEditing(false);
          });
        }}
        disabled={busy}
      />
      <LinkButton label="Cancel" onPress={() => setEditing(false)} />
    </>
  );
}

type Tab = "practice" | "settings";

function Shell({
  client,
  username,
  serverUrl,
  onLogout,
  onChangeServerUrl,
}: {
  client: ApiClient;
  username: string;
  serverUrl: string;
  onLogout: () => void;
  onChangeServerUrl: (url: string) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("practice");
  return (
    <View style={styles.shell}>
      <View style={styles.fill}>
        {tab === "practice" ? (
          <Screen>
            <Scroll>
              <Title text="Practice" />
              <Practice client={client} />
            </Scroll>
          </Screen>
        ) : (
          <SettingsHome
            client={client}
            username={username}
            onLogout={onLogout}
            serverUrl={serverUrl}
            onSaveServerUrl={onChangeServerUrl}
          />
        )}
      </View>
      <TabBar tab={tab} onSelect={setTab} />
    </View>
  );
}

function TabBar({ tab, onSelect }: { tab: Tab; onSelect: (tab: Tab) => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const tabs: { id: Tab; label: string }[] = [
    { id: "practice", label: "Practice" },
    { id: "settings", label: "Settings" },
  ];
  return (
    <View
      style={[
        styles.tabBar,
        {
          borderTopColor: colors.separator,
          backgroundColor: colors.card,
          paddingBottom: insets.bottom,
        },
      ]}
    >
      {tabs.map((t) => (
        <Pressable
          key={t.id}
          accessibilityRole="tab"
          accessibilityLabel={t.label}
          accessibilityState={{ selected: tab === t.id }}
          onPress={() => onSelect(t.id)}
          style={styles.tab}
        >
          <Text
            style={{
              color: tab === t.id ? colors.accent : colors.subtle,
              fontSize: 15,
              fontWeight: tab === t.id ? "600" : "400",
            }}
          >
            {t.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  tabBar: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" },
});
