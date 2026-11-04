import type { ApiClient } from "@vjt/api-client";
import { useReadingSettings } from "@vjt/core";
import { useState } from "react";
import { Card } from "./components/ui/Card.tsx";
import { Field } from "./components/ui/Field.tsx";
import { SwitchRow } from "./components/ui/SwitchRow.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";
import { Text, View } from "react-native";

/**
 * Reading preferences on mobile (#50, on the hub's tokens): the
 * translation-blur toggle and the Lookup hold threshold — how long a lookup
 * must be held before it counts as a Weak Signal. Both feed the Story
 * reader (#45) directly, which is why they live here and nowhere else.
 * The route provides the screen chrome (title, Back, scroll); this is the
 * section's content so first-run setup can embed it too.
 */
export function ReadingSettingsSection({ client }: { client: ApiClient }) {
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

  if (reading.state.status === "loading") {
    // Shaped like what replaces it: the toggle row and the field + Save.
    return (
      <View className="gap-4">
        <SkeletonBar width="100%" height={76} />
        <SkeletonBar width="70%" height={44} />
        <SkeletonBar width="100%" height={72} />
      </View>
    );
  }
  if (reading.state.status === "error") {
    return (
      <InlineError
        message={`Cannot load your reading settings: ${reading.state.message}`}
        onRetry={reading.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-body text-foreground">
        How long you must hold a lookup before it counts as a Weak Signal (0 signals every lookup).
      </Text>
      <Card padded={false}>
        <SwitchRow
          label="Blur the translation behind Weak Signals"
          hint="A word you have not practised enough shows its meaning only after you ask"
          value={stored?.blurTranslation ?? true}
          disabled={busy}
          onToggle={(blurTranslation) => void reading.setBlurTranslation(blurTranslation)}
          last
        />
      </Card>
      <Field
        label="Lookup hold before a Weak Signal (ms, 0–10000)"
        value={holdValue}
        onChangeText={setHoldMs}
        onSubmit={() => void saveHold()}
        keyboardType="number-pad"
        disabled={busy}
      />
      <ActionButton label="Save reading settings" onPress={() => void saveHold()} filled disabled={busy} />
      {saved && (
        <Text accessibilityRole="status" className="text-body text-success">
          Saved — the reader uses this from the next lookup on.
        </Text>
      )}
      {error && <InlineError message={error} />}
    </View>
  );
}
