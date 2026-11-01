import type { ApiClient } from "@vjt/api-client";
import { useStorySettings } from "@vjt/core";
import { useState } from "react";

import { Body, Card, Chip, ChipRow, ErrorText, Field, LinkButton, Muted, PrimaryButton, Screen, Scroll, SectionTitle, StatusText, Title } from "./ui.tsx";

const LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Story preferences (Furigana Threshold, issue #10) on mobile (issue #13):
 * uses `useStorySettings` so the screen never fetches the Story library.
 * Same rule as web: chips 0–9 set the SRS level under which tokens show
 * furigana; genre/theme steer future stories and empty means "surprise me".
 */
export function StorySettingsSection({ client, onBack }: { client: ApiClient; onBack: () => void }) {
  const stories = useStorySettings(client);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [genre, setGenre] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const stored = stories.settings.status === "ready" ? stories.settings.settings : null;
  const thresholdValue = threshold ?? stored?.furiganaThresholdSrsLevel ?? 3;
  const genreValue = genre ?? stored?.preferredGenre ?? "";
  const themeValue = theme ?? stored?.preferredTheme ?? "";

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const res = await stories.saveSettings({
        furiganaThresholdSrsLevel: thresholdValue,
        preferredGenre: genreValue,
        preferredTheme: themeValue,
      });
      if (res.ok) {
        setThreshold(null);
        setGenre(null);
        setTheme(null);
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
            <Field
              label="Preferred genre"
              value={genreValue}
              onChangeText={setGenre}
              maxLength={60}
              placeholder="empty = surprise me"
              disabled={busy}
            />
            <Field
              label="Preferred theme"
              value={themeValue}
              onChangeText={setTheme}
              maxLength={200}
              placeholder="empty = surprise me"
              disabled={busy}
            />
            <PrimaryButton label="Save story settings" onPress={() => void save()} disabled={busy} />
            {saved && <StatusText text="Saved — the next story written for you uses this." />}
            {error && <ErrorText text={error} />}
          </>
        )}
      </Scroll>
    </Screen>
  );
}
