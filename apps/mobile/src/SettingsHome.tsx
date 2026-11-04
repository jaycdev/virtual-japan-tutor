import { View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Row } from "./components/ui/Row.tsx";

/**
 * The Settings sections, single source (issue #50): the union below is
 * derived from this list, the hub menu renders it, and the
 * /settings/[section] route validates params against it — a new section is
 * added in exactly one place. The order is the plan's (§4.7).
 *
 * There is no separate Review section on purpose: the grammar review list
 * is not a hub section, but it is not gone either — it rides along inside
 * the Starting Level section, read-only (issue #6).
 */
export const SETTINGS_SECTIONS = [
  { id: "appearance", title: "Appearance", blurb: "Colour theme and Story text size" },
  { id: "reading", title: "Reading", blurb: "Translation blur and Lookup hold" },
  { id: "stories", title: "Stories", blurb: "Furigana threshold and future story tastes" },
  { id: "lists", title: "Item Lists", blurb: "Lists, boosting and saved items" },
  { id: "level", title: "Starting Level", blurb: "N5–N1 known grammar baseline" },
  { id: "marumori", title: "MaruMori", blurb: "Connect your Junji profile and Sync" },
  { id: "ai", title: "AI Providers", blurb: "Endpoints, keys and task assignments" },
  { id: "server", title: "Server", blurb: "Connection health (and address on Android)" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

/** The Settings sections that are valid route params (#50). */
export const SECTION_IDS: SettingsSection[] = SETTINGS_SECTIONS.map((s) => s.id);

/** The hub's section list: one row per section, pushing its route on tap. */
export function SettingsSectionMenu({ onOpen }: { onOpen: (section: SettingsSection) => void }) {
  return (
    <Card padded={false}>
      {SETTINGS_SECTIONS.map((section, i) => (
        <Row
          key={section.id}
          label={section.title}
          hint={section.blurb}
          onPress={() => onOpen(section.id)}
          last={i === SETTINGS_SECTIONS.length - 1}
        />
      ))}
    </Card>
  );
}

/**
 * The Settings hub (#50): the menu of sections and the Account card, so logging
 * out is one tap from anywhere in Settings. Rows push /settings/:section.
 */
export function SettingsHome({
  username,
  onLogout,
  onOpenSection,
}: {
  username: string;
  onLogout: () => void;
  onOpenSection: (section: SettingsSection) => void;
}) {
  return (
    <View className="gap-6">
      <SettingsSectionMenu onOpen={onOpenSection} />
      <Card padded={false}>
        <Row label="Signed in" hint={username} />
        <Row label="Log out" onPress={onLogout} last />
      </Card>
    </View>
  );
}
