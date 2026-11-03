// App shell bootstrapping for the expo-router tree (#44).
//
// app/_layout.tsx renders <App> around the router's <Slot/>. Everything that
// must exist once for the whole tree lives here: the theme, the bundled fonts,
// the server address hydrated from the secure store, and the auth state. The
// router tree only mounts once signed in; the signed-out, loading, and
// unreachable states replace the whole tree (Login / splash / error), exactly
// as the pre-router shell did.
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";

import { Login } from "./src/Login.tsx";
import { AuthProvider, useSession } from "./src/session.tsx";
import { resolveApiBaseUrl } from "./src/config.ts";
import { appFonts } from "./src/fonts";
import { appSecureStore } from "./src/secureStore";
import { secureStoreServerUrl, type ServerUrlStorage } from "./src/serverUrlStorage.ts";
import { ThemeProvider } from "./src/theme/index.tsx";
import { secureStoreTokenStorage, type TokenStorage } from "./src/tokenStorage.ts";

// One adapter pair for the whole app: the secure store is a process singleton,
// so module scope is honest and keeps Root's defaults referentially stable.
// (secureStore.ts / .native.ts split the storage per platform.)
const tokenStorage = secureStoreTokenStorage(appSecureStore);
const urlStorage = secureStoreServerUrl(appSecureStore);

export default function App({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AppBootstrapped tokenStorage={tokenStorage} urlStorage={urlStorage}>
        {children}
      </AppBootstrapped>
    </ThemeProvider>
  );
}

/**
 * The same shell over injected storage (tests substitute fakes for the native
 * secure store without any module mocking).
 */
export function AppBootstrapped({
  tokenStorage,
  urlStorage,
  fetchOverride,
  children,
}: {
  tokenStorage: TokenStorage;
  urlStorage: ServerUrlStorage;
  fetchOverride?: typeof globalThis.fetch;
  children: React.ReactNode;
}) {
  // Noto JP first (a no-op map on web, where global.css @font-face does it):
  // the first frame must not flicker through the system font.
  useFonts(appFonts);

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

  const changeServerUrl = async (url: string) => {
    await urlStorage.set(url);
    if (url !== serverUrl) {
      // The session token was minted by the old host: forget it before the
      // re-keyed tree starts talking to the new one, so its bearer token is
      // never sent to a different server. The Learner signs in again there.
      await tokenStorage.clear();
    }
    setServerUrl(url);
  };

  if (!serverUrl) return null;

  return (
    <SafeAreaProvider>
      {/* key: a new address means a new ApiClient and a fresh session check. */}
      <AuthProvider
        key={serverUrl}
        serverUrl={serverUrl}
        tokenStorage={tokenStorage}
        fetchOverride={fetchOverride}
        changeServerUrl={changeServerUrl}
      >
        <AuthGate serverUrl={serverUrl} onChangeServerUrl={changeServerUrl}>
          {children}
        </AuthGate>
      </AuthProvider>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

function AuthGate({
  serverUrl,
  onChangeServerUrl,
  children,
}: {
  serverUrl: string;
  onChangeServerUrl: (url: string) => Promise<void>;
  children: React.ReactNode;
}) {
  const auth = useSession();

  if (auth.state.status === "loading") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <View className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground" />
      </View>
    );
  }
  if (auth.state.status === "error") {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <View className="w-full max-w-[380px] gap-3 rounded-2xl bg-card p-6 shadow-md">
          <View className="items-center gap-1">
            <Text className="text-display font-serif text-primary" allowFontScaling={false}>
              読
            </Text>
            <Text className="text-title-sm font-semibold text-foreground">Virtual Japan Tutor</Text>
          </View>
          <Text className="text-small text-destructive" accessibilityRole="alert">
            Cannot reach the server: {auth.state.message}
          </Text>
          <Text className="text-caption text-muted-foreground">Server address: {serverUrl}</Text>
          <RetryButton onPress={auth.retry} />
        </View>
      </View>
    );
  }
  if (auth.state.status === "signedOut") {
    return (
      <Login
        busy={auth.busy}
        error={auth.state.error}
        serverUrl={serverUrl}
        onLogin={(username, password) => void auth.login(username, password)}
        onSaveServerUrl={onChangeServerUrl}
      />
    );
  }
  return <>{children}</>;
}

function RetryButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      className="min-h-12 items-center justify-center rounded-lg bg-primary"
      accessibilityRole="button"
      accessibilityLabel="Retry"
      onPress={onPress}
    >
      <Text className="text-body font-semibold text-primary-foreground">Retry</Text>
    </Pressable>
  );
}
