import type { AiProvider, AiProviderTestResult, AiTask, ApiClient, GrammarReviewItem, MaruMoriSyncRun } from "@vjt/api-client";
import {
  STARTING_LEVELS,
  useAiSettings,
  useGrammarReview,
  useMarumori,
  useStartingLevel,
  type ActionResult,
  type StartingLevel,
} from "@vjt/core";
import { useState, type FormEvent } from "react";

const TASK_LABELS: Record<AiTask, string> = {
  story: "Story generation",
  grammar_content: "Grammar content",
};

interface FormValues {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  removeKey: boolean;
}

const EMPTY: FormValues = { name: "", baseUrl: "", model: "", apiKey: "", removeKey: false };

/** AI Provider settings: saved endpoints, a connection test for each, and which one serves each task. */
function AiProviders({ client }: { client: ApiClient }) {
  const settings = useAiSettings(client);
  const { state } = settings;
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AiProviderTestResult>>({});

  if (state.status === "loading") return <p>Loading…</p>;
  if (state.status === "error") {
    return (
      <>
        <p>Cannot load settings: {state.message}</p>
        <button type="button" onClick={settings.reload}>
          Retry
        </button>
      </>
    );
  }

  /** Runs a mutating action, surfacing its failure message. Returns whether it succeeded. */
  const run = async (action: () => Promise<ActionResult>): Promise<boolean> => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await action();
      if (!res.ok) setError(res.message);
      return res.ok;
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (p: AiProvider) => {
    setEditing(p);
    setForm({ name: p.name, baseUrl: p.baseUrl, model: p.model, apiKey: "", removeKey: false });
    setError(undefined);
  };
  const stopEdit = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const key = form.apiKey.trim();
    const ok = await run(() => {
      if (!editing) {
        return settings.create({
          name: form.name,
          baseUrl: form.baseUrl,
          model: form.model,
          ...(key ? { apiKey: key } : {}),
        });
      }
      // Empty key field = keep the stored key (the field is simply left out).
      return settings.update(editing.id, {
        name: form.name,
        baseUrl: form.baseUrl,
        model: form.model,
        ...(form.removeKey ? { apiKey: null } : key ? { apiKey: key } : {}),
      });
    });
    if (ok) stopEdit(); // also drops the typed key from memory
  };

  const test = async (p: AiProvider) => {
    setTesting(p.id);
    setResults((r) => {
      const next = { ...r };
      delete next[p.id]; // hide the previous result while a new test runs
      return next;
    });
    const result = await settings.test(p.id);
    setResults((r) => ({ ...r, [p.id]: result }));
    setTesting(null);
  };

  const remove = async (p: AiProvider) => {
    setConfirmingDelete(null);
    if (await run(() => settings.remove(p.id)) && editing?.id === p.id) stopEdit();
  };

  const assignedTo = (providerId: string) =>
    state.tasks.filter((t) => t.providerId === providerId).map((t) => TASK_LABELS[t.task]);

  return (
    <section>
      <h2>AI providers</h2>
      {error && <p role="alert">{error}</p>}

      {state.providers.length === 0 ? (
        <p>No providers yet. Add an OpenAI-compatible endpoint below.</p>
      ) : (
        <ul>
          {state.providers.map((p) => (
            <li key={p.id}>
              <strong>{p.name}</strong> — {p.model} at {p.baseUrl} · <span>{p.hasApiKey ? "Key saved" : "No key"}</span>
              {assignedTo(p.id).length > 0 && <> · used for {assignedTo(p.id).join(", ")}</>}
              <div>
                <button type="button" disabled={busy} onClick={() => startEdit(p)}>
                  Edit
                </button>{" "}
                <button type="button" disabled={testing === p.id} onClick={() => void test(p)}>
                  Test connection
                </button>{" "}
                {confirmingDelete === p.id ? (
                  <>
                    <button type="button" disabled={busy} onClick={() => void remove(p)}>
                      Confirm delete
                    </button>{" "}
                    <button type="button" onClick={() => setConfirmingDelete(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busy} onClick={() => setConfirmingDelete(p.id)}>
                    Delete
                  </button>
                )}
              </div>
              {testing === p.id && <span>Testing…</span>}
              {results[p.id] && (
                <p role="status" className={results[p.id]!.ok ? "test-result ok" : "test-result failed"}>
                  {results[p.id]!.ok ? "✓" : "✗"} {results[p.id]!.message} ({results[p.id]!.latencyMs} ms)
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3>{editing ? `Edit ${editing.name}` : "Add a provider"}</h3>
      <form onSubmit={(e) => void submit(e)}>
        <p>
          <label>
            Name
            <input name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
        </p>
        <p>
          <label>
            Base URL
            <input
              name="baseUrl"
              inputMode="url"
              placeholder="https://api.openai.com/v1 or http://localhost:11434"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              required
            />
          </label>
        </p>
        <p>
          <label>
            Model
            <input name="model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} required />
          </label>
        </p>
        <p>
          <label>
            API key
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              placeholder={
                editing?.hasApiKey ? "Key saved — leave empty to keep it" : "Leave empty if the endpoint needs none"
              }
              value={form.apiKey}
              disabled={form.removeKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
            />
          </label>
        </p>
        {editing?.hasApiKey && (
          <p>
            <label>
              <input
                type="checkbox"
                checked={form.removeKey}
                onChange={(e) => setForm({ ...form, removeKey: e.target.checked, apiKey: "" })}
              />{" "}
              Remove the saved key
            </label>
          </p>
        )}
        <button type="submit" disabled={busy}>
          {editing ? "Save changes" : "Add provider"}
        </button>{" "}
        {editing && (
          <button type="button" onClick={stopEdit}>
            Cancel
          </button>
        )}
      </form>

      <h3>Which provider to use</h3>
      {state.tasks.map((t) => (
        <p key={t.task}>
          <label>
            {TASK_LABELS[t.task]}
            <select
              value={t.providerId ?? ""}
              disabled={busy}
              onChange={(e) => void run(() => settings.assign(t.task, e.target.value || null))}
            >
              <option value="">(none)</option>
              {state.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </p>
      ))}
    </section>
  );
}

/** The Settings page: AI providers, the Starting Level, the MaruMori connection and flagged grammar. */
export function Settings({ client }: { client: ApiClient }) {
  return (
    <>
      <AiProviders client={client} />
      <StartingLevelSettings client={client} />
      <MaruMoriSettings client={client} />
      <GrammarReviewSettings client={client} />
    </>
  );
}

/** Starting Level (issue #6): choosing or changing it re-applies Seeded Grammar. */
function StartingLevelSettings({ client }: { client: ApiClient }) {
  const level = useStartingLevel(client);
  const [choice, setChoice] = useState<StartingLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<string | undefined>();

  const stored = level.state.status === "ready" ? level.state.level.level : null;
  const selected = choice ?? stored ?? "N5";

  return (
    <section>
      <h2>Starting Level</h2>
      {level.state.status === "loading" && <p>Loading…</p>}
      {level.state.status === "error" && (
        <>
          <p>Cannot load your Starting Level: {level.state.message}</p>
          <button type="button" onClick={level.reload}>
            Retry
          </button>
        </>
      )}
      {level.state.status === "ready" && (
        <>
          <p>
            {level.state.level.configured
              ? `Starting level: ${level.state.level.level}`
              : "Not chosen yet. Pick one to mark everything at or below it as known."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
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
              })();
            }}
          >
            <p>
              <label>
                Level
                <select
                  name="level"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => setChoice(e.target.value as StartingLevel)}
                >
                  {STARTING_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </p>
            <button type="submit" disabled={busy}>
              Save level
            </button>
          </form>
          {result && (
            <p role="status" className="test-result ok">
              {result}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}

const reviewText = (item: GrammarReviewItem): string =>
  `${item.pattern || item.marumoriId}` +
  (item.jlptLevel ? ` (MaruMori level ${item.jlptLevel})` : "") +
  (item.matchedPointId ? ` — matched point ${item.matchedPointId}, level was ambiguous` : " — no Grammar Catalogue match");

/** The "review these" list (issue #6): grammar Syncs the Catalogue Matching flagged. */
function GrammarReviewSettings({ client }: { client: ApiClient }) {
  const review = useGrammarReview(client);

  return (
    <section>
      <h2>Review these grammar matches</h2>
      {review.state.status === "loading" && <p>Loading…</p>}
      {review.state.status === "error" && (
        <>
          <p>Cannot load the review list: {review.state.message}</p>
          <button type="button" onClick={review.reload}>
            Retry
          </button>
        </>
      )}
      {review.state.status === "ready" &&
        (review.state.items.length === 0 ? (
          <p>Nothing needs a second look.</p>
        ) : (
          <>
            <p>These MaruMori grammar points did not match the Catalogue cleanly. They re-check themselves on later Syncs.</p>
            <ul>
              {review.state.items.map((item) => (
                <li key={item.marumoriId}>{reviewText(item)}</li>
              ))}
            </ul>
          </>
        ))}
    </section>
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

/** MaruMori settings: connect with an API key, Sync knowledge state, see what the last Sync found. */
function MaruMoriSettings({ client }: { client: ApiClient }) {
  const maru = useMarumori(client);
  const { state } = maru;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; text: string } | undefined>();
  const [showRuns, setShowRuns] = useState(false);

  if (state.status === "loading") {
    return (
      <section>
        <h2>MaruMori</h2>
        <p>Loading…</p>
      </section>
    );
  }
  if (state.status === "error") {
    return (
      <section>
        <h2>MaruMori</h2>
        <p>Cannot load MaruMori status: {state.message}</p>
        <button type="button" onClick={maru.reload}>
          Retry
        </button>
      </section>
    );
  }
  const m = state.marumori;

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
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
    <section>
      <h2>MaruMori</h2>
      {error && <p role="alert">{error}</p>}
      {m.connected ? <strong>Connected to MaruMori</strong> : <p>Not connected. Paste your MaruMori API key to connect.</p>}

      {m.connected && m.counts && (
        <p>
          Known kanji: {m.counts.kanji} · Known vocabulary: {m.counts.vocabulary} · Vocabulary linked:{" "}
          {Math.round(m.counts.vocabularyLinkRate * 100)}%
        </p>
      )}
      {m.connected && m.counts?.lastSyncAt && <p>Last Sync {m.counts.lastSyncAt}</p>}
      {m.connected && m.lastFailure && (
        <p className="test-result failed">Last Sync failed: {m.lastFailure.error ?? "unknown error"}</p>
      )}

      <form onSubmit={(e) => void saveKey(e)}>
        <p>
          <label>
            MaruMori API key
            <input
              name="marumoriKey"
              type="password"
              autoComplete="off"
              placeholder={m.connected ? "Key saved — paste a new one to replace it" : "Your MaruMori API key"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
          </label>
        </p>
        <button type="submit" disabled={busy}>
          Save key
        </button>{" "}
        {m.connected &&
          (confirmRemove ? (
            <>
              <button type="button" disabled={busy} onClick={() => void remove()}>
                Confirm remove
              </button>{" "}
              <button type="button" onClick={() => setConfirmRemove(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" disabled={busy} onClick={() => setConfirmRemove(true)}>
              Remove key
            </button>
          ))}
      </form>

      {m.connected && (
        <p>
          <button type="button" disabled={busy} onClick={() => void sync()}>
            Sync now
          </button>{" "}
          <button type="button" onClick={toggleRuns}>
            {showRuns ? "Hide recent Syncs" : "Show recent Syncs"}
          </button>
        </p>
      )}
      {syncResult && (
        <p role="status" className={`test-result ${syncResult.ok ? "ok" : "failed"}`}>
          {syncResult.text}
        </p>
      )}
      {showRuns && maru.runs.status === "loading" && <p>Loading Sync history…</p>}
      {showRuns && maru.runs.status === "error" && <p>Cannot load Sync history: {maru.runs.message}</p>}
      {showRuns && maru.runs.status === "ready" && (
        <ul>
          {maru.runs.runs.map((r) => (
            <li key={r.id}>{runText(r)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
