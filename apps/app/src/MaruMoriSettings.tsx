import type { ApiClient, MaruMoriSyncRun } from "@vjt/api-client";
import { useMarumori } from "@vjt/core";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, Skeleton, SkeletonBar } from "./state/states.tsx";
import type { StepSaveHandle, StepSaveOutcome } from "./settingsSections.tsx";

/**
 * MaruMori connection (#6, on the #50 hub): connect with an API key, Sync
 * the knowledge state now, and see what the recent Syncs found. The key
 * field is masked — a stored key never comes back down the wire, and the
 * typed one is never rendered as text. First-run setup embeds this same
 * component as its second step.
 */
export function MaruMoriSettings({
  client,
  saveHandle,
}: {
  client: ApiClient;
  /** Registered by the setup wizard; absent under the Settings hub (S2). */
  saveHandle?: StepSaveHandle;
}) {
  const maru = useMarumori(client);
  const { state } = maru;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | undefined>();
  const [showRuns, setShowRuns] = useState(false);

  const saveKey = async () => {
    const trimmed = key.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(undefined);
    try {
      const res = await maru.saveKey(trimmed); // also drops the typed key from the form on success
      if (res.ok) setKey("");
      else setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  // S2: the wizard's Next/Finish connects a typed key through the same
  // saveKey path as the Connect button. No key typed is "nothing".
  useEffect(() => {
    if (!saveHandle) return;
    saveHandle.current = async (): Promise<StepSaveOutcome> => {
      const trimmed = key.trim();
      if (!trimmed) return "nothing";
      setBusy(true);
      setError(undefined);
      try {
        const res = await maru.saveKey(trimmed);
        if (res.ok) {
          setKey("");
          return "saved";
        }
        setError(res.message);
        return "blocked";
      } finally {
        setBusy(false);
      }
    };
    return () => {
      saveHandle.current = null;
    };
  });

  const remove = async () => {
    setConfirmRemove(false);
    setBusy(true);
    setError(undefined);
    try {
      const res = await maru.removeKey();
      if (!res.ok) setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    setBusy(true);
    setError(undefined);
    setSyncResult(undefined);
    try {
      const outcome = await maru.sync();
      if (outcome.status === "error") setSyncResult({ ok: false, text: outcome.message });
      else setSyncResult({ ok: outcome.status === "ok", text: outcomeText(outcome) });
    } finally {
      setBusy(false);
    }
  };

  const toggleRuns = () => {
    if (showRuns) setShowRuns(false);
    else {
      setShowRuns(true);
      maru.loadRuns();
    }
  };

  if (state.status === "loading") {
    return (
      <View className="gap-4">
        <SkeletonBar width="60%" height={24} />
        <Skeleton lines={2} />
        <SkeletonBar width="100%" height={72} />
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <InlineError message={`Cannot load MaruMori status: ${state.message}`} onRetry={maru.reload} />
    );
  }

  return (
    <View className="gap-4">
      {error ? <InlineError message={error} /> : null}
      {state.marumori.connected ? (
        <Text className="text-body text-foreground">Connected to MaruMori</Text>
      ) : (
        <Text className="text-body text-muted-foreground">
          Not connected. Paste your MaruMori API key to connect.
        </Text>
      )}
      {state.marumori.connected && state.marumori.counts && (
        <Text className="text-small text-muted-foreground">
          Known kanji: {state.marumori.counts.kanji} · Known vocabulary:{" "}
          {state.marumori.counts.vocabulary} · Vocabulary linked:{" "}
          {Math.round(state.marumori.counts.vocabularyLinkRate * 100)}%
        </Text>
      )}
      {state.marumori.connected && state.marumori.counts?.lastSyncAt && (
        <Text className="text-small text-muted-foreground">
          Last Sync {state.marumori.counts.lastSyncAt}
        </Text>
      )}
      {state.marumori.connected && state.marumori.lastFailure && (
        <InlineError
          message={`Last Sync failed: ${state.marumori.lastFailure.error ?? "unknown error"}`}
        />
      )}

      <Text className="text-small font-semibold uppercase text-muted-foreground">API key</Text>
      <Field
        label="MaruMori API key"
        value={key}
        onChangeText={setKey}
        onSubmit={() => void saveKey()}
        secure
        placeholder={
          state.marumori.connected ? "Key saved — paste a new one to replace it" : "Your MaruMori API key"
        }
        disabled={busy}
      />
      <ActionButton label="Save key" onPress={() => void saveKey()} filled disabled={busy || key.trim() === ""} />
      {state.marumori.connected &&
        (confirmRemove ? (
          <View className="flex-row gap-3">
            <LinkButton label="Confirm remove" onPress={() => void remove()} danger />
            <LinkButton label="Keep" onPress={() => setConfirmRemove(false)} />
          </View>
        ) : (
          <LinkButton label="Remove key" onPress={() => setConfirmRemove(true)} disabled={busy} danger />
        ))}

      {state.marumori.connected && (
        <>
          <Text className="text-small font-semibold uppercase text-muted-foreground">Sync</Text>
          <ActionButton label="Sync now" onPress={() => void sync()} filled disabled={busy} />
          <LinkButton
            label={showRuns ? "Hide recent Syncs" : "Show recent Syncs"}
            onPress={toggleRuns}
          />
        </>
      )}
      {syncResult && (
        <Text
          role="status"
          accessibilityLiveRegion="polite"
          className={`text-body ${syncResult.ok ? "text-success" : "text-destructive"}`}
        >
          {syncResult.text}
        </Text>
      )}
      {showRuns && maru.runs.status === "loading" && <Skeleton lines={3} />}
      {showRuns && maru.runs.status === "error" && (
        <InlineError message={`Cannot load Sync history: ${maru.runs.message}`} />
      )}
      {showRuns && maru.runs.status === "ready" && (
        <Card>
          {maru.runs.runs.length === 0 ? (
            <Text className="text-body text-muted-foreground">No Syncs yet.</Text>
          ) : (
            maru.runs.runs.map((r) => (
              <Text key={r.id} className="text-small text-muted-foreground">
                {runText(r)}
              </Text>
            ))
          )}
        </Card>
      )}
    </View>
  );
}

const outcomeText = (run: MaruMoriSyncRun): string => {
  if (run.status === "failed") return `Sync failed: ${run.error ?? "unknown error"}`;
  const c = run.counts;
  if (!c) return "Sync complete";
  return `Sync complete — ${c.new} new Known Items, ${c.levelChanges} level changes, ${c.disappeared} disappeared`;
};

const runText = (r: MaruMoriSyncRun): string =>
  `${r.startedAt} — ${r.status}` +
  (r.error ? ` — ${r.error}` : "") +
  (r.counts ? ` — ${r.counts.kanji} kanji, ${r.counts.vocabulary} vocabulary` : "");
