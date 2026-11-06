// MaruMori (issue #6; ported from apps/mobile MaruMoriSettings): connect with an
// API key, Sync now, and see the recent Syncs. The key is write-only: a saved key
// shows as "set" with Replace, and is never put back into a field.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatInstantRuby, syncOutcomeText, syncRunText, useMarumori, useT, type InterfaceLanguage, type RubyText, type StepSaveOutcome, type StepSaveRegistrar } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { T } from "@/components/Text";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { Fact, Note, SaveStatus, SectionBody, Subheading, TextField, type SaveState } from "../parts.tsx";

// The Last Sync instant as param segments (round-5 review): English keeps the
// device-locale toLocaleString the line always showed — formatInstantRuby
// would rewrite it to "November 1, 08:00". The Japanese forms go through the
// ruby date formatter, which is the point of the change (A3).
function lastSyncWhen(iso: string, language: InterfaceLanguage): RubyText {
  return language === "en"
    ? [{ text: new Date(iso).toLocaleString() }]
    : formatInstantRuby(iso, undefined, language);
}

export function MaruMoriSection({ registerSave }: { registerSave?: StepSaveRegistrar }) {
  const { client } = useSession();
  const { language } = useT();
  const maru = useMarumori(client);
  const [draft, setDraft] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [showRuns, setShowRuns] = useState(false);
  // Removing the key unmounts the confirm buttons it was standing on; the
  // heading takes focus instead (issue #81 review).
  const keyHeadingRef = useRef<HTMLHeadingElement>(null);

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
      setSave({ kind: "saved", message: <T k="marumori.connected" /> });
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
    return <ErrorState message={<T k="marumori.loadFailed" params={{ message: maru.state.message }} />} onRetry={maru.reload} />;
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
    keyHeadingRef.current?.focus();
    setSave(res.ok ? { kind: "saved", message: <T k="marumori.keyRemoved" /> } : { kind: "error", message: res.message });
  };

  const sync = async () => {
    setSyncResult(null);
    setSave({ kind: "saving" });
    const outcome = await maru.sync();
    setSave({ kind: "idle" });
    if (outcome.status === "error") setSyncResult({ ok: false, text: outcome.message });
    else setSyncResult({ ok: outcome.status === "ok", text: syncOutcomeText(outcome, language) });
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
        <p className="text-body text-foreground">
          <T k={connected ? "marumori.connected" : "marumori.notConnected"} />
        </p>
        {connected && status.counts ? (
          <Note>
            <T
              k="marumori.counts"
              params={{
                kanji: status.counts.kanji,
                vocabulary: status.counts.vocabulary,
                rate: Math.round(status.counts.vocabularyLinkRate * 100),
              }}
            />
          </Note>
        ) : null}
        {connected && status.counts?.lastSyncAt ? (
          <Note>
            <T k="marumori.lastSync" params={{ when: lastSyncWhen(status.counts.lastSyncAt, language) }} />
          </Note>
        ) : null}
        {connected && status.lastFailure ? (
          <p role="alert" className="text-small text-destructive">
            {status.lastFailure.error ? (
              // The server's own words are data: plain in the {error} slot. The
              // fallback sentence is a whole table entry so its furigana
              // survives (issue #125 round-2 review S2).
              <T k="marumori.syncFailed" params={{ error: status.lastFailure.error }} />
            ) : (
              <T k="marumori.syncFailedUnknown" />
            )}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-4">
        <Subheading ref={keyHeadingRef}>
          <T k="marumori.apiKeyHeading" />
        </Subheading>
        {connected && !replacing ? (
          // The Replace button lives inside the dd: a bare <div> child of <dl> is not
          // valid markup (issue #81 review), and the label keeps the heading from
          // repeating above.
          <dl className="flex flex-col gap-2">
            <Fact label={<T k="marumori.savedKey" />}>
              <span className="flex flex-wrap items-center gap-3">
                <T k="marumori.keySet" />
                <Button type="button" variant="outline" disabled={busy} onClick={() => setReplacing(true)}>
                  <T k="marumori.replace" />
                </Button>
              </span>
            </Fact>
          </dl>
        ) : null}
        {keyInputVisible ? (
          <form className="flex flex-col gap-4" onSubmit={(event) => void submitKey(event)} noValidate>
            <TextField
              id="marumori-key"
              label={<T k="marumori.keyLabel" />}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              disabled={busy}
              hint={connected ? <T k="marumori.keyHint" /> : undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" disabled={busy || draft.trim() === ""}>
                <T k="marumori.saveKey" />
              </Button>
              {connected ? (
                <Button type="button" variant="ghost" onClick={() => { setReplacing(false); setDraft(""); }}>
                  <T k="marumori.keepKey" />
                </Button>
              ) : null}
            </div>
          </form>
        ) : null}
        {connected ? (
          confirmRemove ? (
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>
                <T k="marumori.confirmRemove" />
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirmRemove(false)}>
                <T k="stories.deleteKeep" />
              </Button>
            </div>
          ) : (
            <div>
              <Button type="button" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmRemove(true)}>
                <T k="marumori.removeKey" />
              </Button>
            </div>
          )
        ) : null}
      </div>

      {connected ? (
        <div className="flex flex-col gap-4">
          <Subheading>
            <T k="marumori.syncHeading" />
          </Subheading>
          <div className="flex flex-wrap items-center gap-4">
            <Button type="button" disabled={busy} onClick={() => void sync()}>
              <T k="marumori.syncNow" />
            </Button>
            <Button type="button" variant="ghost" onClick={toggleRuns}>
              <T k={showRuns ? "marumori.hideRuns" : "marumori.showRuns"} />
            </Button>
          </div>
          {syncResult ? (
            <p role="status" className={syncResult.ok ? "text-small text-success" : "text-small text-destructive"}>
              {syncResult.text}
            </p>
          ) : null}
          {showRuns && maru.runs.status === "loading" ? <SkeletonLines lines={3} /> : null}
          {showRuns && maru.runs.status === "error" ? (
            <ErrorState message={<T k="marumori.runsLoadFailed" params={{ message: maru.runs.message }} />} />
          ) : null}
          {showRuns && maru.runs.status === "ready" ? (
            maru.runs.runs.length === 0 ? (
              <p className="text-body text-muted-foreground">
                <T k="marumori.noRuns" />
              </p>
            ) : (
              <ul className="flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
                {maru.runs.runs.map((run) => (
                  <li key={run.id} className="text-small text-muted-foreground">
                    {syncRunText(run, language)}
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
