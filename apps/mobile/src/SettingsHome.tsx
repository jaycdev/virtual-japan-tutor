import type { ApiClient } from "@vjt/api-client";
import { useState } from "react";

import { AiProvidersSettings } from "./AiProvidersSettings.tsx";
import { ItemListsSettings } from "./ItemListsSettings.tsx";
import { MaruMoriSettings } from "./MaruMoriSettings.tsx";
import { ReadingSettingsSection } from "./ReadingSettingsSection.tsx";
import { ServerSettings } from "./ServerSettings.tsx";
import { StartingLevelSettings } from "./StartingLevelSettings.tsx";
import { StorySettingsSection } from "./StorySettingsSection.tsx";
import { Card, Row, Screen, Scroll, Title } from "./ui.tsx";

type Section = "marumori" | "ai" | "level" | "stories" | "reading" | "lists" | "server";

/**
 * Settings hub (issue #13): a list of grouped rows opening state-driven
 * master-detail screens — the same no-router approach the app shell and the
 * web App use, kept simple and testable. The Account card lives here too, so
 * logging out is one tap from anywhere in Settings.
 */
export function SettingsHome({
  client,
  username,
  onLogout,
  serverUrl,
  onSaveServerUrl,
}: {
  client: ApiClient;
  username: string;
  onLogout: () => void;
  serverUrl: string;
  onSaveServerUrl: (url: string) => Promise<void>;
}) {
  const [section, setSection] = useState<Section | null>(null);
  const back = () => setSection(null);

  if (section === "marumori") return <MaruMoriSettings client={client} onBack={back} />;
  if (section === "ai") return <AiProvidersSettings client={client} onBack={back} />;
  if (section === "level") return <StartingLevelSettings client={client} onBack={back} />;
  if (section === "stories") return <StorySettingsSection client={client} onBack={back} />;
  if (section === "reading") return <ReadingSettingsSection client={client} onBack={back} />;
  if (section === "lists") return <ItemListsSettings client={client} onBack={back} />;
  if (section === "server")
    return <ServerSettings currentUrl={serverUrl} onSave={onSaveServerUrl} onBack={back} />;

  return (
    <Screen>
      <Scroll>
        <Title text="Settings" />
        <Card>
          <Row label="MaruMori" hint="Connect your Junji profile and Sync" onPress={() => setSection("marumori")} />
          <Row label="AI Providers" hint="Endpoints, keys and task assignments" onPress={() => setSection("ai")} />
          <Row label="Starting Level" hint="N5–N1 known grammar baseline" onPress={() => setSection("level")} />
          <Row label="Stories" hint="Furigana threshold and future story tastes" onPress={() => setSection("stories")} />
          <Row label="Reading" hint="Lookup hold threshold" onPress={() => setSection("reading")} />
          <Row label="Item Lists" hint="Lists, boosting and saved items" onPress={() => setSection("lists")} />
          <Row label="Server" hint={serverUrl} onPress={() => setSection("server")} last />
        </Card>
        <Card>
          <Row label="Signed in" hint={username} />
          <Row label="Log out" onPress={onLogout} last />
        </Card>
      </Scroll>
    </Screen>
  );
}
