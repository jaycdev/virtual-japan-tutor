// The app's version and the server's, with a warning when they are different releases (#117).
// Shown in Settings > Server, under the health line; the server version comes from GET /health
// through the shared client (useHealth).
import Constants from "expo-constants";
import { Text, View } from "react-native";

import { versionMismatchNotice } from "./versionNotice.ts";

export function VersionLines({ serverVersion }: { serverVersion: string | undefined }) {
  const appVersion = Constants.expoConfig?.version ?? "unknown";
  const notice = serverVersion ? versionMismatchNotice(appVersion, serverVersion) : null;

  return (
    <View className="gap-1">
      <Text className="text-small text-muted-foreground">App version: {appVersion}</Text>
      <Text className="text-small text-muted-foreground">Server version: {serverVersion ?? "unknown"}</Text>
      {notice ? (
        <Text role="alert" className="text-small text-destructive">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
