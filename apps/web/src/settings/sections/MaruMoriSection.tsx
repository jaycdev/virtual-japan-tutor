// MaruMori (issue #6; ported from apps/mobile MaruMoriSettings): connect with an
// API key, Sync now, and see the recent Syncs. The key is write-only: a saved key
// shows as "set" with Replace, and is never put back into a field.
import { useEffect, useState, type FormEvent } from "react";
import { syncOutcomeText, syncRunText, useMarumori, type StepSaveOutcome, type StepSaveRegistrar } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { Fact, Note, SaveStatus, SectionBody, Subheading, TextField, type SaveState } from "../parts.tsx";

export function MaruMoriSection({ registerSave }: { registerSave?: StepSaveRegistrar }) {
  const { client } = useSession();
  const maru = useMarumori(client);
  const [draft, setDraft] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showRuns, setShowRuns] = useState(false);

  const busy = save.kind === "saving";

  // Connects the typed key. Shared by the Connect button and the setup wizard's Next (review S2).
  const connect = async (): Promise<StepSaveOutcome> => {
    const trimmed = draft.trim();
    if (!trimmed) return "nothing";
    setSave({ kind: "saving" });
    const res = await maru.saveKey(trimmed);
    if (res.ok) {
      setDraft("");
      setReplacing(false);
      setSave({ kind: "saved", message: "Connected to MaruMori." });
      return "saved";
    }
    setSave({ kind: "error", message: res.message });
    return "blocked";
  };

  useEffect(() => {
    if (!registerSave) return;
    registerSave(connect);
    return () => registerSave(null);
  });

  if (maru.state.status === "loading") return <SkeletonLines lines={3} />;
  if (maru.state.status === "error") {
    return <ErrorState message={`Cannot load MaruMori status: ${maru.state.message}`} onRetry={maru.reload} />;
  }

  const status = maru.state.marumori;
  const connected = status.connected;
  const keyInputVisible = !connected || replacing;

  const submitKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (draft.trim() === "") return;
    await connect();
  };

  const remove = async () => {
    setConfirmRemove(false);
    setSave({ kind: "saving" });
    const res = await maru.removeKey();
    setSave(res.ok ? { kind: "saved", message: "The MaruMori key was removed." } : { kind: "error", message: res.message });
  };

  const sync = async () => {
    setSyncResult(null);
    setSave({ kind: "saving" });
    const outcome = await maru.sync();
    setSave({ kind: "idle" });
    if (outcome.status === "error") setSyncResult({ ok: false, text: outcome.message });
    else setSyncResult({ ok: outcome.status === "ok", text: syncOutcomeText(outcome) });
  };

  const toggleRuns = () => {
    if (showRuns) setShowRuns(false);
    else {
      setShowRuns(true);
      maru.loadRuns();
    }
  };

  return (
    <SectionBody>
      <div className="flex flex-col gap-2">
        <p className="text-body text-foreground">{connected ? "Connected to MaruMori." : "Not connected."}</p>
        {connected && status.counts ? (
          <Note>
            Known kanji: {status.counts.kanji} · Known vocabulary: {status.counts.vocabulary} · Vocabulary linked:{" "}
            {Math.round(status.counts.vocabularyLinkRate * 100)}%
          </Note>
        ) : null}
        {connected && status.counts?.lastSyncAt ? (
          <Note>Last Sync {new Date(status.counts.lastSyncAt).toLocaleString()}</Note>
        ) : null}
        {connected && status.lastFailure ? (
          <p role="alert" className="text-small text-destructive">
            Last Sync failed: {status.lastFailure.error ?? "unknown error"}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Subheading>API key</Subheading>
        {connected && !replacing ? (
          <dl className="flex flex-wrap items-center gap-6">
            <Fact label="MaruMori API key">set</Fact>
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setReplacing(true)}>
                Replace
              </Button>
            </div>
          </dl>
        ) : null}
        {keyInputVisible ? (
          <form className="flex flex-col gap-4" onSubmit={(event) => void submitKey(event)} noValidate>
            <TextField
              id="marumori-key"
              label="MaruMori API key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              disabled={busy}
              hint={connected ? "Paste a new key to replace the saved one. The saved key is never shown." : undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={busy || draft.trim() === ""}>
                Save key
              </Button>
              {connected ? (
                <Button type="button" variant="ghost" onClick={() => { setReplacing(false); setDraft(""); }}>
                  Keep the saved key
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
        {connected ? (
          confirmRemove ? (
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
                Confirm remove
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmRemove(false)}>
                Keep
              </Button>
            </div>
          ) : (
            <div>
              <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
                Remove key
              </Button>
            </div>
          )
        ) : null}
      </div>

      {connected ? (
        <div className="flex flex-col gap-4">
          <Subheading>Sync</Subheading>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="button" disabled={busy} onClick={() => void sync()}>
              Sync now
            </Button>
            <Button type="button" variant="ghost" onClick={toggleRuns}>
              {showRuns ? "Hide recent Syncs" : "Show recent Syncs"}
            </Button>
          </div>
          {syncResult ? (
            <p role="status" className={syncResult.ok ? "text-small text-success" : "text-small text-destructive"}>
              {syncResult.text}
            </p>
          ) : null}
          {showRuns && maru.runs.status === "loading" ? <SkeletonLines lines={3} /> : null}
          {showRuns && maru.runs.status === "error" ? (
            <ErrorState message={`Cannot load Sync history: ${maru.runs.message}`} />
          ) : null}
          {showRuns && maru.runs.status === "ready" ? (
            maru.runs.runs.length === 0 ? (
              <p className="text-body text-muted-foreground">No Syncs yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
                {maru.runs.runs.map((run) => (
                  <li key={run.id} className="text-small text-muted-foreground">
                    {syncRunText(run)}
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </div>
      ) : null}

      <SaveStatus state={save} />
    </SectionBody>
  );
}
