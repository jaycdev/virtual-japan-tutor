// Reading (ui-plan 4.7; ported from apps/mobile ReadingSettingsSection): the
// translation blur and the Lookup hold, which the Story reader reads directly.
import { useState, type FormEvent } from "react";
import { parseLookupHold, useReadingSettings } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { Note, SaveStatus, SectionBody, SwitchField, TextField, type SaveState } from "../parts.tsx";

export function ReadingSection() {
  const { client } = useSession();
  const reading = useReadingSettings(client);
  // The Lookup hold as typed; null until the Learner edits it.
  const [hold, setHold] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  if (reading.state.status === "loading") return <SkeletonLines lines={3} />;
  if (reading.state.status === "error") {
    return <ErrorState message={`Cannot load your reading settings: ${reading.state.message}`} onRetry={reading.reload} />;
  }

  const stored = reading.state.settings;
  const holdValue = hold ?? String(stored.lookupHoldMs);
  const parsed = parseLookupHold(holdValue);
  const holdError = hold !== null && !parsed.ok ? parsed.message : undefined;
  const busy = save.kind === "saving";

  const toggleBlur = async (blurTranslation: boolean) => {
    setSave({ kind: "saving" });
    const res = await reading.setBlurTranslation(blurTranslation);
    setSave(res.ok ? { kind: "saved" } : { kind: "error", message: res.message });
  };

  const submitHold = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsed.ok) return;
    setSave({ kind: "saving" });
    const res = await reading.setLookupHoldMs(parsed.ms);
    if (res.ok) {
      setHold(null);
      setSave({ kind: "saved", message: "Saved. The reader uses this from the next lookup on." });
    } else setSave({ kind: "error", message: res.message });
  };

  return (
    <SectionBody>
      <SwitchField
        id="reading-blur"
        label="Blur the translation behind Weak Signals"
        hint="A word you have not practised enough shows its meaning only after you ask."
        checked={stored.blurTranslation}
        disabled={busy}
        onChange={(checked) => void toggleBlur(checked)}
      />

      <form className="flex flex-col gap-4" onSubmit={(event) => void submitHold(event)} noValidate>
        <Note>How long you must hold a lookup before it counts as a Weak Signal. 0 signals every lookup.</Note>
        <TextField
          id="reading-hold"
          label="Lookup hold before a Weak Signal (ms, 0–10000)"
          inputMode="numeric"
          autoComplete="off"
          value={holdValue}
          onChange={(event) => setHold(event.target.value)}
          disabled={busy}
          error={holdError}
        />
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy || !parsed.ok}>
            Save reading settings
          </Button>
          <SaveStatus state={save} />
        </div>
      </form>
    </SectionBody>
  );
}
