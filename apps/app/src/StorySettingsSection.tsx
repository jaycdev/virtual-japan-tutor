import type { ApiClient } from "@vjt/api-client";
import { deviceTimezone, TIMEZONE_OPTIONS, useStoryGeneration, useStorySettings } from "@vjt/core";
import { useState } from "react";

import { AutocompleteField, Body, Card, Chip, ChipRow, ErrorText, LinkButton, Muted, PrimaryButton, Screen, Scroll, SectionTitle, StatusText, Title } from "./ui.tsx";

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Story preferences (Furigana Threshold #10, preferred genre/theme and the
 * Learner's Timezone #32) on mobile (#13, parity #34): uses
 * `useStorySettings`, so the screen never fetches the Story library, and
 * `useStoryGeneration` for the suggestion lists only. Genre and theme are
 * autocompleted like web's; the Timezone box offers the same curated zone list
 * from core plus a one-click fill of the device's own zone. Empty genre/theme
 * means "surprise me", empty timezone "the server's day".
 */
export function StorySettingsSection({ client, onBack }: { client: ApiClient; onBack: () => void }) {
  const stories = useStorySettings(client);
  const gen = useStoryGeneration(client);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const stored = stories.settings.status === "ready" ? stories.settings.settings : null;
  const thresholdValue = threshold ?? stored?.furiganaThresholdSrsLevel ?? 3;
  const genreValue = genre ?? stored?.preferredGenre ?? "";
  const themeValue = theme ?? stored?.preferredTheme ?? "";
  const timezoneValue = timezone ?? stored?.timezone ?? "";
  const device = deviceTimezone();

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const res = await stories.saveSettings({
        furiganaThresholdSrsLevel: thresholdValue,
        preferredGenre: genreValue,
        preferredTheme: themeValue,
        timezone: timezoneValue,
      });
      if (res.ok) {
        setThreshold(null);
        setGenre(null);
        setTheme(null);
        setTimezone(null);
        setSaved(true);
      } else setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Scroll>
        <Title text="Stories" onBack={onBack} />
        {stories.settings.status === "loading" && <Muted text="Loading…" />}
        {stories.settings.status === "error" && (
          <>
            <ErrorText text={`Cannot load your story settings: ${stories.settings.message}`} />
            <LinkButton label="Retry" onPress={stories.reloadSettings} />
          </>
        )}
        {stories.settings.status === "ready" && (
          <>
            <SectionTitle text="Furigana Threshold" />
            <Body text="Words you have practised below this SRS level show reading help." />
            <Card>
              <ChipRow>
                {LEVELS.map((l) => (
                  <Chip
                    key={l}
                    label={String(l)}
                    selected={thresholdValue === l}
                    onPress={() => setThreshold(l)}
                  />
                ))}
              </ChipRow>
            </Card>
            <SectionTitle text="Future stories" />
            <AutocompleteField
              label="Preferred genre"
              value={genreValue}
              onChangeText={setGenre}
              maxLength={60}
              placeholder="travel, mystery… empty = surprise me"
              disabled={busy}
              options={gen.suggestions.genres}
            />
            <AutocompleteField
              label="Preferred theme"
              value={themeValue}
              onChangeText={setTheme}
              maxLength={200}
              placeholder="a robot running a ramen shop — empty = none"
              disabled={busy}
              options={gen.suggestions.themes}
            />
            <SectionTitle text="Your timezone" />
            <Body text="This decides which local day each Automatic Story belongs to." />
            <AutocompleteField
              label="Timezone"
              value={timezoneValue}
              onChangeText={setTimezone}
              maxLength={64}
              placeholder="Asia/Tokyo — empty = the server's day"
              disabled={busy}
              options={TIMEZONE_OPTIONS}
            />
            {device ? (
              <LinkButton label="Use my device’s timezone" disabled={busy} onPress={() => setTimezone(device)} />
            ) : null}
            <PrimaryButton label="Save story settings" onPress={() => void save()} disabled={busy} />
            {saved && <StatusText text="Saved — the next story written for you uses this." />}
            {error && <ErrorText text={error} />}
          </>
        )}
      </Scroll>
    </Screen>
  );
}
