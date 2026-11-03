import { Card, Row, Screen, Scroll, Title } from "./ui.tsx";

export type SettingsSection =
  | "marumori"
  | "ai"
  | "level"
  | "stories"
  | "reading"
  | "lists"
  | "server";

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
