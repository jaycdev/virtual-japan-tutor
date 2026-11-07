// The app's version and the server's, with a warning when they are different releases (#117).
// Shown in Settings > Server, under the health line; the server version comes from GET /health
// through the shared client (useHealth).
import Constants from "expo-constants";
import { View } from "react-native";

import { T } from "./components/Text.tsx";
import { versionMismatchNotice } from "./versionNotice.ts";

export function VersionLines({ serverVersion }: { serverVersion: string | undefined }) {
  const appVersion = Constants.expoConfig?.version ?? "unknown";
  const notice = serverVersion ? versionMismatchNotice(appVersion, serverVersion) : null;

  return (
    <View className="gap-1">
      <T k="mobile.appVersion" params={{ version: appVersion }} className="text-small text-muted-foreground" />
      <T
        k="mobile.serverVersion"
        params={{ version: serverVersion ?? "unknown" }}
        className="text-small text-muted-foreground"
      />
      {notice ? (
        // The alert wrapper stays a View: a furigana line is a row of columns,
        // and a status line keeps its role around it.
        <View role="alert">
          <T k="mobile.versionMismatch" params={notice} className="text-small text-destructive" />
        </View>
      ) : null}
    </View>
  );
}
