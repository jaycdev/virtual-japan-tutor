import { useLocalSearchParams, useRouter } from "expo-router";

import type { SettingsSection } from "../../src/SettingsHome.tsx";
import { useSession } from "../../src/session.tsx";
import { EmptyState } from "../../src/state/states.tsx";
import { AiProvidersSettings } from "../../src/AiProvidersSettings.tsx";
import { ItemListsSettings } from "../../src/ItemListsSettings.tsx";
import { MaruMoriSettings } from "../../src/MaruMoriSettings.tsx";
import { ReadingSettingsSection } from "../../src/ReadingSettingsSection.tsx";
import { ServerSettings } from "../../src/ServerSettings.tsx";
import { StartingLevelSettings } from "../../src/StartingLevelSettings.tsx";
import { StorySettingsSection } from "../../src/StorySettingsSection.tsx";

const SECTIONS: readonly SettingsSection[] = [
  "marumori",
  "ai",
  "level",
  "stories",
  "reading",
  "lists",
  "server",
];

/**
 * Settings sections as routes (#44): each /settings/:section renders the
 * existing section component with its Back wired to router.back (so Android
 * hardware Back pops it like any other screen). An unknown section gets the
 * shared EmptyState rather than a blank screen.
 */
export default function SettingsSectionRoute() {
  const { section } = useLocalSearchParams<{ section: string }>();
  const router = useRouter();
  const session = useSession();
  const onBack = () => router.back();

  if (!SECTIONS.includes(section as SettingsSection)) {
    return (
      <EmptyState
        message="That settings section doesn’t exist."
        actionLabel="Back to settings"
        onAction={() => router.replace("/settings")}
      />
    );
  }

  switch (section) {
    case "marumori":
      return <MaruMoriSettings client={session.client} onBack={onBack} />;
    case "ai":
      return <AiProvidersSettings client={session.client} onBack={onBack} />;
    case "level":
      return <StartingLevelSettings client={session.client} onBack={onBack} />;
    case "stories":
      return <StorySettingsSection client={session.client} onBack={onBack} />;
    case "reading":
      return <ReadingSettingsSection client={session.client} onBack={onBack} />;
    case "lists":
      return <ItemListsSettings client={session.client} onBack={onBack} />;
    case "server":
      return (
        <ServerSettings
          currentUrl={session.serverUrl}
          onSave={session.changeServerUrl}
          onBack={onBack}
        />
      );
  }
}
