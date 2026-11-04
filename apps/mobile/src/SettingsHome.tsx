import { View } from "react-native";
import { SETTINGS_SECTIONS, type SettingsSection } from "@vjt/core";

import { Card } from "./components/ui/Card.tsx";
import { Row } from "./components/ui/Row.tsx";

// The section list itself lives in @vjt/core (one list for web and mobile); the
// /settings/[section] route validates params against it.
export { SETTINGS_SECTIONS, type SettingsSection } from "@vjt/core";

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
