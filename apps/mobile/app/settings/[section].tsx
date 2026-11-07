import { ScrollView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import { sectionTitleKey, SETTINGS_SECTIONS, type SettingsSection } from "@vjt/core";

import { useSession } from "../../src/session.tsx";
import { useJapaneseFont } from "../../src/japaneseFont/index.tsx";
import { SectionBack, SectionHeading } from "../../src/settingsSections.tsx";
import { EmptyState } from "../../src/state/states.tsx";
import { T, useTp } from "../../src/components/Text.tsx";
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
  const jp = useJapaneseFont();
  const tp = useTp();
  const onBack = () => (router.canGoBack() ? router.back() : router.replace("/settings"));

  const found = SETTINGS_SECTIONS.find((s) => s.id === section);
  if (!found) {
    return (
      <EmptyState
        message={<T k="settings.notFound" className="text-body text-foreground" />}
        actionLabel={tp("mobile.backToSettings")}
        onAction={() => router.replace("/settings")}
      />
    );
  }

  return (
    <ScrollView className="flex-1" contentContainerStyle={{ padding: 16 }}>
      <SectionBack label={tp("setup.back")} onPress={onBack} />
      <SectionHeading>
        <T
          k={sectionTitleKey(found.id)}
          className={`text-title-sm ${jp.regular} text-foreground`}
          accessibilityRole="header"
        />
      </SectionHeading>
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
