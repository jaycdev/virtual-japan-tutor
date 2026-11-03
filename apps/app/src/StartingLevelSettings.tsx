import type { ApiClient } from "@vjt/api-client";
import { STARTING_LEVELS, useStartingLevel, type StartingLevel } from "@vjt/core";
import { useState } from "react";

import { Body, Card, Chip, ChipRow, ErrorText, LinkButton, Muted, PrimaryButton, Screen, Scroll, StatusText, Title } from "./ui.tsx";

/**
 * Starting Level (issue #6, on mobile for issue #13): N5–N1 chips pick the
 * level; saving re-applies Seeded Grammar and reports the server's counts,
 * exactly like the web section.
 */
export function StartingLevelSettings({ client, onBack }: { client: ApiClient; onBack: () => void }) {
  const level = useStartingLevel(client);
  const [choice, setChoice] = useState<StartingLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<string | undefined>();

  const stored = level.state.status === "ready" ? level.state.level.level : null;
  const selected = choice ?? stored ?? "N5";

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const res = await level.setLevel(selected);
      if ("status" in res) setError(res.message);
      else setResult(`Grammar updated: ${res.added ?? 0} added, ${res.removed ?? 0} removed.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Scroll>
        <Title text="Starting Level" onBack={onBack} />
        {level.state.status === "loading" && <Muted text="Loading…" />}
        {level.state.status === "error" && (
          <>
            <ErrorText text={`Cannot load your Starting Level: ${level.state.message}`} />
            <LinkButton label="Retry" onPress={level.reload} />
          </>
        )}
        {level.state.status === "ready" && (
          <>
            <Body
              text={
                level.state.level.configured
                  ? `Starting level: ${level.state.level.level}`
                  : "Not chosen yet. Pick one to mark everything at or below it as known."
              }
            />
            <Card>
              <ChipRow>
                {STARTING_LEVELS.map((l) => (
                  <Chip
                    key={l}
                    label={l}
                    selected={selected === l}
                    onPress={() => setChoice(l)}
                  />
                ))}
              </ChipRow>
            </Card>
            <PrimaryButton label="Save level" onPress={() => void save()} disabled={busy} />
            {result && <StatusText text={result} />}
            {error && <ErrorText text={error} />}
          </>
        )}
      </Scroll>
    </Screen>
  );
}
