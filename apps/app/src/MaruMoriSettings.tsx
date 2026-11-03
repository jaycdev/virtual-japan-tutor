import type { ApiClient, MaruMoriSyncRun } from "@vjt/api-client";
import { useMarumori } from "@vjt/core";
import { useState } from "react";

import { Body, Card, ErrorText, Field, LinkButton, Muted, PrimaryButton, Screen, Scroll, SectionTitle, StatusText, Title } from "./ui.tsx";

/**
 * MaruMori settings (issue #6, on mobile for issue #13): connect with an API
 * key, Sync the knowledge state now, and see what the recent Syncs found —
 * the same flow as the web section, one screen.
 */
export function MaruMoriSettings({ client, onBack }: { client: ApiClient; onBack: () => void }) {
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

  return (
    <Screen>
      <Scroll>
        <Title text="MaruMori" onBack={onBack} />
        {state.status === "loading" && <Muted text="Loading…" />}
        {state.status === "error" && (
          <>
            <ErrorText text={`Cannot load MaruMori status: ${state.message}`} />
            <LinkButton label="Retry" onPress={maru.reload} />
          </>
        )}
        {state.status === "ready" && (
          <>
            {error ? <ErrorText text={error} /> : null}
            {state.marumori.connected ? (
              <Body text="Connected to MaruMori" />
            ) : (
              <Muted text="Not connected. Paste your MaruMori API key to connect." />
            )}
            {state.marumori.connected && state.marumori.counts && (
              <Muted
                text={`Known kanji: ${state.marumori.counts.kanji} · Known vocabulary: ${state.marumori.counts.vocabulary} · Vocabulary linked: ${Math.round(state.marumori.counts.vocabularyLinkRate * 100)}%`}
              />
            )}
            {state.marumori.connected && state.marumori.counts?.lastSyncAt && (
              <Muted text={`Last Sync ${state.marumori.counts.lastSyncAt}`} />
            )}
            {state.marumori.connected && state.marumori.lastFailure && (
              <ErrorText text={`Last Sync failed: ${state.marumori.lastFailure.error ?? "unknown error"}`} />
            )}

            <SectionTitle text="API key" />
            <Field
              label="MaruMori API key"
              value={key}
              onChangeText={setKey}
              onSubmit={() => void saveKey()}
              secure
              placeholder={state.marumori.connected ? "Key saved — paste a new one to replace it" : "Your MaruMori API key"}
              disabled={busy}
            />
            <PrimaryButton
              label="Save key"
              onPress={() => void saveKey()}
              disabled={busy || key.trim() === ""}
            />
            {state.marumori.connected &&
              (confirmRemove ? (
                <>
                  <LinkButton label="Confirm remove" onPress={() => void remove()} danger />
                  <LinkButton label="Keep" onPress={() => setConfirmRemove(false)} />
                </>
              ) : (
                <LinkButton label="Remove key" onPress={() => setConfirmRemove(true)} disabled={busy} danger />
              ))}

            {state.marumori.connected && (
              <>
                <SectionTitle text="Sync" />
                <PrimaryButton label="Sync now" onPress={() => void sync()} disabled={busy} />
                <LinkButton
                  label={showRuns ? "Hide recent Syncs" : "Show recent Syncs"}
                  onPress={toggleRuns}
                />
              </>
            )}
            {syncResult && <StatusText text={syncResult.text} ok={syncResult.ok} />}
            {showRuns && maru.runs.status === "loading" && <Muted text="Loading Sync history…" />}
            {showRuns && maru.runs.status === "error" && (
              <ErrorText text={`Cannot load Sync history: ${maru.runs.message}`} />
            )}
            {showRuns && maru.runs.status === "ready" && (
              <Card>
                {maru.runs.runs.map((r) => (
                  <Body key={r.id} text={runText(r)} />
                ))}
              </Card>
            )}
          </>
        )}
      </Scroll>
    </Screen>
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
