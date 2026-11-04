import type { ApiClient } from "@vjt/api-client";
import { STARTING_LEVELS, useStartingLevel, type StartingLevel } from "@vjt/core";
import { useState } from "react";
import { Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";

/**
 * Starting Level (#6, on the #50 hub): N5–N1 chips pick the level; saving
 * re-applies Seeded Grammar and reports the server's counts. First-run
 * setup shows this same component as its first step, so the Settings
 * section and the setup screen cannot drift apart.
 */
export function StartingLevelSettings({ client }: { client: ApiClient }) {
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

  if (level.state.status === "loading") {
    // Shaped like the picker it replaces: a line of prose and the chip row.
    return (
      <View className="gap-4">
        <SkeletonBar width="80%" height={24} />
        <SkeletonBar width="100%" height={44} />
      </View>
    );
  }
  if (level.state.status === "error") {
    return (
      <InlineError
        message={`Cannot load your Starting Level: ${level.state.message}`}
        onRetry={level.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-body text-foreground">
        {level.state.level.configured
          ? `Starting level: ${level.state.level.level}`
          : "Not chosen yet. Pick one to mark everything at or below it as known."}
      </Text>
      <Card>
        <ChipRow>
          {STARTING_LEVELS.map((l) => (
            <Chip key={l} label={l} selected={selected === l} onPress={() => setChoice(l)} />
          ))}
        </ChipRow>
      </Card>
      <ActionButton label="Save level" onPress={() => void save()} filled disabled={busy} />
      {result && (
        <Text role="status" accessibilityLiveRegion="polite" className="text-body text-success">
          {result}
        </Text>
      )}
      {error && <InlineError message={error} />}
    </View>
  );
}
