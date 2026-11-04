import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { SETTINGS_SECTIONS, type SettingsSection } from "../../src/SettingsHome.tsx";
import { useSession } from "../../src/session.tsx";
import { SectionBack, SectionHeading } from "../../src/settingsSections.tsx";
import { EmptyState } from "../../src/state/states.tsx";
import { AppearanceSettings } from "../../src/AppearanceSettings.tsx";
import { ReadingSettingsSection } from "../../src/ReadingSettingsSection.tsx";
import { StartingLevelSettings } from "../../src/StartingLevelSettings.tsx";
import { MaruMoriSettings } from "../../src/MaruMoriSettings.tsx";
import { ServerSettings } from "../../src/ServerSettings.tsx";
import { StorySettingsSection } from "../../src/StorySettingsSection.tsx";
import { AiProvidersSettings } from "../../src/AiProvidersSettings.tsx";
import { ItemListsSettings } from "../../src/ItemListsSettings.tsx";

/**
 * One Settings section, as a route (#44, hub layout #50): a Back button, the
 * section's title and its content, pushed from the hub. An unknown section gets
 * the shared EmptyState, and Back on a fresh tab (deep link, nothing under the
 * route) replaces with the hub so the screen is never a dead end.
 */
export default function SettingsSectionRoute() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const router = useRouter();
  const session = useSession();
  const onBack = () => (router.canGoBack() ? router.back() : router.replace("/settings"));

  const found = SETTINGS_SECTIONS.find((s) => s.id === section);
  if (!found) {
    return (
      <EmptyState
        message="That settings section doesn’t exist."
        actionLabel="Back to settings"
        onAction={() => router.replace("/settings")}
      />
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
      <SectionBack label="Back" onPress={onBack} />
      <SectionHeading>{found.title}</SectionHeading>
      <SectionBody section={found.id} client={session.client} session={session} />
    </ScrollView>
  );
}

function SectionBody({
  section,
  client,
  session,
}: {
  section: SettingsSection;
  client: ReturnType<typeof useSession>["client"];
  session: ReturnType<typeof useSession>;
}) {
  switch (section) {
    case "appearance":
      return <AppearanceSettings />;
    case "reading":
      return <ReadingSettingsSection client={client} />;
    case "stories":
      return <StorySettingsSection client={client} />;
    case "lists":
      return <ItemListsSettings client={client} />;
    case "level":
      return <StartingLevelSettings client={client} />;
    case "marumori":
      return <MaruMoriSettings client={client} />;
    case "ai":
      return <AiProvidersSettings client={client} />;
    case "server":
      return (
        <ServerSettings
          client={client}
          currentUrl={session.serverUrl}
          onSave={session.changeServerUrl}
        />
      );
  }
}
