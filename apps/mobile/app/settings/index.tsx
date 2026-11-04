import { ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";

import {
  SettingsHome,
  SettingsSectionMenu,
  type SettingsSection,
} from "../../src/SettingsHome.tsx";
import { useSession } from "../../src/session.tsx";
import { SectionHeading, useWideLayout } from "../../src/settingsSections.tsx";
import { AppearanceSettings } from "../../src/AppearanceSettings.tsx";

/**
 * The settings hub (#50). Narrow screens show the section list full width
 * (tapping a row opens the section route); wide screens show the list
 * beside an open section, mirroring the two-pane layout of
 * `settings/[section]` so the page structure never changes between sections.
 *
 * P2 (review): the wide hub opens the first section — Appearance — instead
 * of showing an EmptyState that asks for a click before anything is visible.
 * The pane is a default, not a route: the URL stays /settings until a row
 * is tapped, so Back never loops here.
 * P1: the two panes' content starts at the same y — the menu carries the
 * same 16 px top padding as the section pane.
 */
export default function SettingsIndexRoute() {
  const router = useRouter();
  const session = useSession();
  const wide = useWideLayout();

  if (wide) {
    return (
      <View className="flex-1 flex-row">
        <View className="w-80 shrink-0 p-4 pr-0">
          <SettingsSectionMenu active="appearance" onOpen={(id) => router.push(`/settings/${id}`)} />
        </View>
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
          <SectionHeading>Appearance</SectionHeading>
          <AppearanceSettings />
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
