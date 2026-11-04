import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  SettingsHome,
  SettingsSectionMenu,
  type SettingsSection,
} from "../../src/SettingsHome.tsx";
import { useSession } from "../../src/session.tsx";
import { useWideLayout } from "../../src/settingsSections.tsx";
import { EmptyState } from "../../src/state/states.tsx";

/**
 * The settings hub (#50). Narrow screens show the section list full width
 * (tapping a row opens the section route); wide screens show the list
 * beside a placeholder pane, mirroring the two-pane layout of
 * `settings/[section]` so the page structure never changes between sections.
 */
export default function SettingsIndexRoute() {
  const router = useRouter();
  const session = useSession();
  const wide = useWideLayout();

  if (wide) {
    return (
      <View className="flex-1 flex-row">
        <View className="w-80 pr-4">
          <SettingsSectionMenu onOpen={(id) => router.push(`/settings/${id}`)} />
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ flexGrow: 1 }}>
          <EmptyState message="Pick a settings section to change it. Changes apply as soon as you save." />
        </ScrollView>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
      <Text className="mb-4 text-title font-serif text-foreground">Settings</Text>
      <SettingsHome
        username={session.state.status === "signedIn" ? session.state.user.username : ""}
        onLogout={() => void session.logout()}
        // Push, not replace: hardware/browser Back from a section returns to
        // the hub (the app-shell test pins this trail).
        onOpenSection={(id: SettingsSection) => router.push(`/settings/${id}`)}
      />
    </ScrollView>
  );
}
