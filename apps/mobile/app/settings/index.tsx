import { ScrollView, Text } from "react-native";
import { useRouter } from "expo-router";

import { SettingsHome, type SettingsSection } from "../../src/SettingsHome.tsx";
import { useSession } from "../../src/session.tsx";

/**
 * The settings hub (#50): the section list full width. Tapping a row pushes the
 * section route (`settings/[section]`), so Back from a section returns here.
 */
export default function SettingsIndexRoute() {
  const router = useRouter();
  const session = useSession();

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
      <Text className="mb-4 text-title font-serif text-foreground">Settings</Text>
      <SettingsHome
        username={session.state.status === "signedIn" ? session.state.user.username : ""}
        onLogout={() => void session.logout()}
        // Push, not replace: hardware Back from a section returns to the hub
        // (the app-shell test pins this trail).
        onOpenSection={(id: SettingsSection) => router.push(`/settings/${id}`)}
      />
    </ScrollView>
  );
}
