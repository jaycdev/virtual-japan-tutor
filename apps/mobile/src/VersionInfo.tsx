// Shows the app's version and the server's, and warns when they are different releases (#117).
// The server reports its version on the unauthenticated GET /health, so this works on the login
// screen too. A server that can't be reached shows "unavailable" and no warning.
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { versionMismatchNotice } from "./versionNotice.ts";

type ServerVersion = { state: "loading" } | { state: "known"; version: string } | { state: "unavailable" };

export function VersionInfo({ serverUrl }: { serverUrl: string }) {
  const appVersion = Constants.expoConfig?.version ?? "unknown";
  const [server, setServer] = useState<ServerVersion>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`${serverUrl}/health`)
      .then(async (res) => {
        const body = (await res.json()) as { version?: string };
        if (cancelled) return;
        setServer(body.version ? { state: "known", version: body.version } : { state: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setServer({ state: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const serverVersion = server.state === "known" ? server.version : undefined;
  const notice = serverVersion ? versionMismatchNotice(appVersion, serverVersion) : null;

  return (
    <View className="gap-1">
      <Text className="text-caption text-muted-foreground">App version: {appVersion}</Text>
      <Text className="text-caption text-muted-foreground">
        Server version: {server.state === "loading" ? "checking…" : (serverVersion ?? "unavailable")}
      </Text>
      {notice ? <Text className="text-small text-destructive">{notice}</Text> : null}
    </View>
  );
}
