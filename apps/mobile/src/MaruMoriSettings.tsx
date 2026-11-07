import type { ApiClient } from "@vjt/api-client";
import {
  formatInstantRuby,
  syncOutcomeRuby,
  syncRunRuby,
  useMarumori,
  useT,
} from "@vjt/core";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { T, TableText } from "./components/Text.tsx";
import { Card } from "./components/ui/Card.tsx";
import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, Skeleton, SkeletonBar } from "./state/states.tsx";
import type { StepSaveOutcome, StepSaveRegistrar } from "./settingsSections.tsx";

/**
 * MaruMori connection (#6, on the #50 hub): connect with an API key, Sync
 * the knowledge state now, and see what the recent Syncs found. The key
 * field is masked — a stored key never comes back down the wire, and the
 * typed one is never rendered as text. First-run setup embeds this same
 * component as its second step.
 */
export function MaruMoriSettings({
  client,
  registerSave,
}: {
  client: ApiClient;
  /** Handed the step-save by the setup wizard; absent under the Settings hub (S2). */
  registerSave?: StepSaveRegistrar;
}) {
  const maru = useMarumori(client);
  const { state } = maru;
  const { language, tp } = useT();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [syncResult, setSyncResult] = useState<
    Awaited<ReturnType<typeof maru.sync>> | undefined
  >();
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
  // saveKey path as the Connect button. No key typed is "nothing". The
  // save is re-registered after every render, so the last thing typed is
  // what Next saves.
  useEffect(() => {
    if (!registerSave) return;
    registerSave(async (): Promise<StepSaveOutcome> => {
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
    });
    return () => registerSave(null);
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
      setSyncResult(await maru.sync());
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
      <InlineError
        message={<T k="marumori.loadFailed" params={{ message: state.message }} />}
        onRetry={maru.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      {error ? <InlineError message={error} /> : null}
      {state.marumori.connected ? (
        <T k="mobile.marumoriConnected" className="text-body text-foreground" />
      ) : (
        <T k="mobile.marumoriNotConnected" className="text-body text-muted-foreground" />
      )}
      {state.marumori.connected && state.marumori.counts && (
        <T
          k="mobile.marumoriCounts"
          params={{
            kanji: state.marumori.counts.kanji,
            vocabulary: state.marumori.counts.vocabulary,
            linkRate: Math.round(state.marumori.counts.vocabularyLinkRate * 100),
          }}
          className="text-small text-muted-foreground"
        />
      )}
      {/* P5: the raw ISO stamp read like a debug dump. Same humanising and
          device-timezone fallback Today's sync lines use (formatInstantRuby
          with no Learner Timezone falls back to the device's). */}
      {state.marumori.connected && state.marumori.counts?.lastSyncAt && (
        <T
          k="marumori.lastSync"
          params={{ when: formatInstantRuby(state.marumori.counts.lastSyncAt, undefined, language) }}
          className="text-small text-muted-foreground"
        />
      )}
      {state.marumori.connected && state.marumori.lastFailure && (
        <InlineError
          message={
            state.marumori.lastFailure.error ? (
              <T k="marumori.syncFailed" params={{ error: state.marumori.lastFailure.error }} />
            ) : (
              <T k="marumori.syncFailedUnknown" />
            )
          }
        />
      )}

      <T k="marumori.apiKeyHeading" className="text-small font-semibold uppercase text-muted-foreground" />
      <Field
        label={<T k="marumori.keyLabel" className="text-small text-muted-foreground" />}
        value={key}
        onChangeText={setKey}
        onSubmit={() => void saveKey()}
        secure
        placeholder={
          state.marumori.connected
            ? tp("mobile.marumoriKeySavedPlaceholder")
            : tp("mobile.marumoriKeyPlaceholder")
        }
        disabled={busy}
      />
      <ActionButton
        label={<T k="marumori.saveKey" className="text-body font-semibold text-primary-foreground" />}
        onPress={() => void saveKey()}
        filled
        disabled={busy || key.trim() === ""}
      />
      {state.marumori.connected &&
        (confirmRemove ? (
          <View className="flex-row gap-3">
            <LinkButton
              label={<T k="marumori.confirmRemove" className="text-body text-destructive" />}
              onPress={() => void remove()}
              danger
            />
            <LinkButton
              label={<T k="stories.deleteKeep" className="text-body text-primary" />}
              onPress={() => setConfirmRemove(false)}
            />
          </View>
        ) : (
          <LinkButton
            label={<T k="marumori.removeKey" className="text-body text-destructive" />}
            onPress={() => setConfirmRemove(true)}
            disabled={busy}
            danger
          />
        ))}

      {state.marumori.connected && (
        <>
          <T k="marumori.syncHeading" className="text-small font-semibold uppercase text-muted-foreground" />
          <ActionButton
            label={<T k="marumori.syncNow" className="text-body font-semibold text-primary-foreground" />}
            onPress={() => void sync()}
            filled
            disabled={busy}
          />
          <LinkButton
            label={
              showRuns ? (
                <T k="marumori.hideRuns" className="text-body text-primary" />
              ) : (
                <T k="marumori.showRuns" className="text-body text-primary" />
              )
            }
            onPress={toggleRuns}
          />
        </>
      )}
      {syncResult && (
        // The live status line. TableText's own roles do not include
        // "status", so the wrapper carries it, as ServerSettings does. The
        // server's own error words stay plain — they are not ours to annotate.
        <View role="status" accessibilityLiveRegion="polite">
          {syncResult.status === "error" ? (
            <Text className="text-body text-destructive">{syncResult.message}</Text>
          ) : (
            <TableText
              segments={syncOutcomeRuby(syncResult, language)}
              className={`text-body ${syncResult.status === "ok" ? "text-success" : "text-destructive"}`}
            />
          )}
        </View>
      )}
      {showRuns && maru.runs.status === "loading" && <Skeleton lines={3} />}
      {showRuns && maru.runs.status === "error" && (
        <InlineError
          message={<T k="marumori.runsLoadFailed" params={{ message: maru.runs.message }} />}
        />
      )}
      {showRuns && maru.runs.status === "ready" && (
        <Card>
          {maru.runs.runs.length === 0 ? (
            <T k="marumori.noRuns" className="text-body text-muted-foreground" />
          ) : (
            maru.runs.runs.map((r) => (
              // startedAt and status are the server's own words; ours come
              // from the table, readings and all.
              <TableText
                key={r.id}
                segments={syncRunRuby(r, language)}
                className="text-small text-muted-foreground"
              />
            ))
          )}
        </Card>
      )}
    </View>
  );
}


