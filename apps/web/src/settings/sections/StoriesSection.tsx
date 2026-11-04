// Stories (ui-plan 4.5, 4.7; ported from apps/mobile StorySettingsSection): the
// Furigana Threshold, the genre and theme future Stories aim for, and the
// Learner's Timezone, which decides which local day each Automatic Story belongs to.
import { useState, type FormEvent } from "react";
import { deviceTimezone, FURIGANA_LEVELS, suggestionsFor, TIMEZONE_OPTIONS, useStoryGeneration, useStorySettings } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { ChoiceGroup, Note, SaveStatus, SectionBody, TextField, type SaveState } from "../parts.tsx";

const THRESHOLD_OPTIONS = FURIGANA_LEVELS.map((level) => ({ value: level, label: String(level) }));

interface Draft {
  threshold?: number;
  genre?: string;
  theme?: string;
  timezone?: string;
}

export function StoriesSection() {
  const { client } = useSession();
  const stories = useStorySettings(client);
  const generation = useStoryGeneration(client);
  const [draft, setDraft] = useState<Draft>({});
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  if (stories.settings.status === "loading") return <SkeletonLines lines={4} />;
  if (stories.settings.status === "error") {
    return (
      <ErrorState message={`Cannot load your story settings: ${stories.settings.message}`} onRetry={stories.reloadSettings} />
    );
  }

  const stored = stories.settings.settings;
  const threshold = draft.threshold ?? stored.furiganaThresholdSrsLevel ?? 3;
  const genre = draft.genre ?? stored.preferredGenre ?? "";
  const theme = draft.theme ?? stored.preferredTheme ?? "";
  const timezone = draft.timezone ?? stored.timezone ?? "";
  const device = deviceTimezone();
  const busy = save.kind === "saving";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSave({ kind: "saving" });
    const res = await stories.saveSettings({
      furiganaThresholdSrsLevel: threshold,
      preferredGenre: genre,
      preferredTheme: theme,
      timezone,
    });
    if (res.ok) {
      setDraft({});
      setSave({ kind: "saved", message: "Saved. The next Story written for you uses this." });
    } else setSave({ kind: "error", message: res.message });
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
      <SectionBody>
        <ChoiceGroup
          legend="Furigana Threshold"
          options={THRESHOLD_OPTIONS}
          value={threshold}
          onChange={(value) => setDraft({ ...draft, threshold: value })}
          disabled={busy}
        />
        <Note>Words you have practised below this SRS level show reading help.</Note>

        <Suggested
          id="stories-genre"
          label="Preferred genre"
          placeholder="travel, mystery… empty = surprise me"
          value={genre}
          options={generation.suggestions.genres}
          maxLength={60}
          disabled={busy}
          onChange={(value) => setDraft({ ...draft, genre: value })}
        />
        <Suggested
          id="stories-theme"
          label="Preferred theme"
          placeholder="a robot running a ramen shop — empty = none"
          value={theme}
          options={generation.suggestions.themes}
          maxLength={200}
          disabled={busy}
          onChange={(value) => setDraft({ ...draft, theme: value })}
        />

        <Note>This decides which local day each Automatic Story belongs to.</Note>
        <Suggested
          id="stories-timezone"
          label="Your timezone"
          placeholder="Asia/Tokyo — empty = the server’s day"
          value={timezone}
          options={TIMEZONE_OPTIONS}
          maxLength={64}
          disabled={busy}
          onChange={(value) => setDraft({ ...draft, timezone: value })}
        />
        {device ? (
          <div>
            <Button type="button" variant="link" className="px-0" disabled={busy} onClick={() => setDraft({ ...draft, timezone: device })}>
              Use my device’s timezone ({device})
            </Button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy}>
            Save story settings
          </Button>
          <SaveStatus state={save} />
        </div>
      </SectionBody>
    </form>
  );
}

/**
 * A free-text field with suggestions as chips (issue #34): typed text filters
 * them, tapping one fills the field. The list is a convenience, not a whitelist.
 */
function Suggested({
  id,
  label,
  placeholder,
  value,
  options,
  maxLength,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  options: readonly string[];
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const { show, visible } = suggestionsFor(options, value, focused);
  return (
    <div className="flex flex-col gap-2">
      <TextField
        id={id}
        label={label}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        // Sticky once focused, so the chips stay in the tab order when the Learner tabs into them.
        onFocus={() => setFocused(true)}
      />
      {!disabled && show ? (
        <ul className="flex flex-wrap gap-2" aria-label={`${label} suggestions`}>
          {visible.map((option) => {
            const selected = option.toLowerCase() === value.trim().toLowerCase();
            return (
              <li key={option}>
                <Button
                  type="button"
                  size="default"
                  variant={selected ? "default" : "secondary"}
                  className="min-h-9 rounded-full px-3 py-1 text-small"
                  aria-pressed={selected}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onChange(option)}
                >
                  {option}
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
