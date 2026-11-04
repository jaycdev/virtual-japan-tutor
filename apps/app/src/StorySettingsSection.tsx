import type { ApiClient } from "@vjt/api-client";
import { deviceTimezone, TIMEZONE_OPTIONS, useStoryGeneration, useStorySettings } from "@vjt/core";
import { useState } from "react";
import { Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";

const LEVELS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * Story preferences (Furigana Threshold #10, preferred genre/theme and the
 * Learner's Timezone #32) on the #50 hub: uses `useStorySettings`, so the
 * screen never fetches the Story library, and `useStoryGeneration` for the
 * suggestion lists only. Genre and theme are autocompleted like web's; the
 * Timezone box offers the same curated zone list from core plus a one-click
 * fill of the device's own zone. Empty genre/theme means "surprise me",
 * empty timezone "the server's day".
 */
export function StorySettingsSection({ client }: { client: ApiClient }) {
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

  if (stories.settings.status === "loading") {
    // Shaped like the panel it replaces: the threshold chips, then fields.
    return (
      <View className="gap-4">
        <SkeletonBar width="50%" height={24} />
        <SkeletonBar width="100%" height={44} />
        <SkeletonBar width="100%" height={72} />
        <SkeletonBar width="100%" height={72} />
      </View>
    );
  }
  if (stories.settings.status === "error") {
    return (
      <InlineError
        message={`Cannot load your story settings: ${stories.settings.message}`}
        onRetry={stories.reloadSettings}
      />
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-small font-semibold uppercase text-muted-foreground">
        Furigana Threshold
      </Text>
      <Text className="text-body text-foreground">
        Words you have practised below this SRS level show reading help.
      </Text>
      <Card>
        <ChipRow>
          {LEVELS.map((l) => (
            <Chip key={l} label={String(l)} selected={thresholdValue === l} onPress={() => setThreshold(l)} />
          ))}
        </ChipRow>
      </Card>
      <Text className="text-small font-semibold uppercase text-muted-foreground">Future stories</Text>
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
      <Text className="text-small font-semibold uppercase text-muted-foreground">Your timezone</Text>
      <Text className="text-body text-foreground">
        This decides which local day each Automatic Story belongs to.
      </Text>
      <AutocompleteField
        label="Timezone"
        value={timezoneValue}
        onChangeText={setTimezone}
        maxLength={64}
        placeholder="Asia/Tokyo — empty = the server’s day"
        disabled={busy}
        options={TIMEZONE_OPTIONS}
      />
      {device ? (
        <LinkButton label="Use my device’s timezone" disabled={busy} onPress={() => setTimezone(device)} />
      ) : null}
      <ActionButton label="Save story settings" onPress={() => void save()} filled disabled={busy} />
      {saved && (
        <Text accessibilityRole="status" className="text-body text-success">
          Saved — the next story written for you uses this.
        </Text>
      )}
      {error && <InlineError message={error} />}
    </View>
  );
}

/**
 * A free-text box with a list of suggestions (issue #34): typed text filters
 * the suggestions, and tapping one fills the box. Like the web's, the list
 * is a convenience, not a whitelist: whatever is typed is what gets sent.
 */
function AutocompleteField({
  label,
  value,
  onChangeText,
  options,
  placeholder,
  maxLength,
  disabled = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  options: string[];
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = options.filter((o) => q === "" || o.toLowerCase().includes(q));
  const visible = matches.slice(0, 8);
  return (
    <View className="gap-2">
      <Field
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        onFocus={() => setShowAll(true)}
      />
      {!disabled && (q !== "" || showAll) && visible.length > 0 ? (
        <ChipRow>
          {visible.map((o) => (
            <Chip
              key={o}
              label={o}
              selected={o.toLowerCase() === value.trim().toLowerCase()}
              onPress={() => onChangeText(o)}
            />
          ))}
        </ChipRow>
      ) : null}
    </View>
  );
}
