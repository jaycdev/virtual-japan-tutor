import type { ApiClient } from "@vjt/api-client";
import {
  deviceTimezone,
  FURIGANA_LEVELS,
  suggestionsFor,
  TIMEZONE_OPTIONS,
  useStoryGeneration,
  useStorySettings,
  useT,
} from "@vjt/core";
import { useState, type ReactNode } from "react";
import { View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { T } from "./components/Text.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";

const LEVELS = FURIGANA_LEVELS;

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
  const { tp } = useT();
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
        message={tp("mobile.storySettingsLoadFailed", { message: stories.settings.message })}
        onRetry={stories.reloadSettings}
      />
    );
  }

  return (
    <View className="gap-4">
      <T k="settings.furiganaLegend" className="text-small font-semibold uppercase text-muted-foreground" />
      <T k="settings.furiganaNote" className="text-body text-foreground" />
      <Card>
        <ChipRow>
          {LEVELS.map((l) => (
            <Chip key={l} label={String(l)} selected={thresholdValue === l} onPress={() => setThreshold(l)} />
          ))}
        </ChipRow>
      </Card>
      <T k="mobile.futureStories" className="text-small font-semibold uppercase text-muted-foreground" />
      <AutocompleteField
        label={<T k="settings.genreLabel" className="text-small text-muted-foreground" />}
        value={genreValue}
        onChangeText={setGenre}
        maxLength={60}
        placeholder={tp("settings.genrePlaceholder")}
        disabled={busy}
        options={gen.suggestions.genres}
      />
      <AutocompleteField
        label={<T k="settings.themeLabel" className="text-small text-muted-foreground" />}
        value={themeValue}
        onChangeText={setTheme}
        maxLength={200}
        placeholder={tp("settings.themePlaceholder")}
        disabled={busy}
        options={gen.suggestions.themes}
      />
      <T k="settings.timezoneLabel" className="text-small font-semibold uppercase text-muted-foreground" />
      <T k="settings.timezoneNote" className="text-body text-foreground" />
      <AutocompleteField
        label={<T k="mobile.timezoneFieldLabel" className="text-small text-muted-foreground" />}
        value={timezoneValue}
        onChangeText={setTimezone}
        maxLength={64}
        placeholder={tp("settings.timezonePlaceholder")}
        disabled={busy}
        options={TIMEZONE_OPTIONS}
      />
      {device ? (
        <LinkButton
          label={<T k="mobile.deviceTimezone" className="text-body text-primary" />}
          disabled={busy}
          onPress={() => setTimezone(device)}
        />
      ) : null}
      <ActionButton
        label={<T k="settings.saveStories" className="text-body font-semibold text-primary-foreground" />}
        onPress={() => void save()}
        filled
        disabled={busy}
      />
      {saved && (
        <View accessibilityLiveRegion="polite">
          <T k="mobile.storySavedNote" className="text-body text-success" />
        </View>
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
  label: ReactNode;
  value: string;
  onChangeText: (text: string) => void;
  options: string[];
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const { show, visible } = suggestionsFor(options, value, focused);
  return (
    <View className="gap-2">
      <Field
        label={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        onFocus={() => setFocused(true)}
      />
      {!disabled && show ? (
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
