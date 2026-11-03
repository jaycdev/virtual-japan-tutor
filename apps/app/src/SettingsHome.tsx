import { Card, Row, Screen, Scroll, Title } from "./ui.tsx";

/**
 * The settings sections, single source: the union below is derived from this
 * list, and the /settings/[section] route validates params against the same
 * array, so a new section is added in exactly one place.
 */
export const SETTINGS_SECTIONS = [
  "marumori",
  "ai",
  "level",
  "stories",
  "reading",
  "lists",
  "server",
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/**
 * Settings hub (#44): a list of grouped rows into the /settings/:section
 * routes. Sections and hardware Back are the router's now — this component is
 * just the menu, plus the Account card so logging out is one tap from
 * anywhere in Settings.
 */
export function SettingsHome({
  username,
  onLogout,
  serverUrl,
  onOpenSection,
}: {
  username: string;
  onLogout: () => void;
  serverUrl: string;
  onOpenSection: (section: SettingsSection) => void;
}) {
  return (
    <Screen>
      <Scroll>
        <Title text="Settings" />
        <Card>
          <Row label="MaruMori" hint="Connect your Junji profile and Sync" onPress={() => onOpenSection("marumori")} />
          <Row label="AI Providers" hint="Endpoints, keys and task assignments" onPress={() => onOpenSection("ai")} />
          <Row label="Starting Level" hint="N5–N1 known grammar baseline" onPress={() => onOpenSection("level")} />
          <Row label="Stories" hint="Furigana threshold and future story tastes" onPress={() => onOpenSection("stories")} />
          <Row label="Reading" hint="Lookup hold threshold" onPress={() => onOpenSection("reading")} />
          <Row label="Item Lists" hint="Lists, boosting and saved items" onPress={() => onOpenSection("lists")} />
          <Row label="Server" hint={serverUrl} onPress={() => onOpenSection("server")} last />
        </Card>
        <Card>
          <Row label="Signed in" hint={username} />
          <Row label="Log out" onPress={onLogout} last />
        </Card>
      </Scroll>
    </Screen>
  );
}
