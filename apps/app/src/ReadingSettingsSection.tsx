import type { ApiClient } from "@vjt/api-client";
import { useReadingSettings } from "@vjt/core";
import { useState } from "react";

import { Body, ErrorText, Field, LinkButton, Muted, PrimaryButton, Screen, Scroll, StatusText, Title } from "./ui.tsx";

/**
 * Reading preferences on mobile (issue #13): the Lookup hold threshold — how
 * long a lookup must be held before it counts as a Weak Signal. The
 * translation-blur toggle lives on the web reader; mobile has no reader yet,
 * so this screen only exposes the hold (the hook still PUTs both fields).
 */
export function ReadingSettingsSection({ client, onBack }: { client: ApiClient; onBack: () => void }) {
  const reading = useReadingSettings(client);
  const [holdMs, setHoldMs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const stored = reading.state.status === "ready" ? reading.state.settings : null;
  const holdValue = holdMs ?? String(stored?.lookupHoldMs ?? 800);

  const saveHold = async () => {
    setError(undefined);
    setSaved(false);
    const ms = Number(holdValue);
    if (!Number.isInteger(ms) || ms < 0 || ms > 10000) {
      setError("The hold is a whole number of milliseconds from 0 to 10000.");
      return;
    }
    setBusy(true);
    try {
      const res = await reading.setLookupHoldMs(ms);
      if (res.ok) {
        setHoldMs(null);
        setSaved(true);
      } else setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Scroll>
        <Title text="Reading" onBack={onBack} />
        {reading.state.status === "loading" && <Muted text="Loading…" />}
        {reading.state.status === "error" && (
          <>
            <ErrorText text={`Cannot load your reading settings: ${reading.state.message}`} />
            <LinkButton label="Retry" onPress={reading.reload} />
          </>
        )}
        {reading.state.status === "ready" && (
          <>
            <Body text="How long you must hold a lookup before it counts as a Weak Signal (0 signals every lookup)." />
            <Field
              label="Lookup hold before a Weak Signal (ms, 0–10000)"
              value={holdValue}
              onChangeText={setHoldMs}
              onSubmit={() => void saveHold()}
              keyboardType="number-pad"
              disabled={busy}
            />
            <PrimaryButton label="Save reading settings" onPress={() => void saveHold()} disabled={busy} />
            {saved && <StatusText text="Saved — the reader uses this from the next lookup on." />}
            {error && <ErrorText text={error} />}
          </>
        )}
      </Scroll>
    </Screen>
  );
}
