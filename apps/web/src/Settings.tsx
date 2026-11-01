import type {
  AiProvider,
  AiProviderTestResult,
  AiTask,
  ApiClient,
  GrammarReviewItem,
  ItemList,
  MaruMoriSyncRun,
} from "@vjt/api-client";
import {
  STARTING_LEVELS,
  useAiSettings,
  useGrammarReview,
  useItemLists,
  useMarumori,
  useReadingSettings,
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

/** The Settings page: AI providers, Item Lists, the Starting Level, the MaruMori connection and flagged grammar. */
export function Settings({ client }: { client: ApiClient }) {
  return (
    <>
      <AiProviders client={client} />
      <ItemListsSettings client={client} />
      <ReadingSettingsSection client={client} />
      <StartingLevelSettings client={client} />
      <MaruMoriSettings client={client} />
      <GrammarReviewSettings client={client} />
    </>
  );
}

/** The built-in Saved list: it cannot be renamed or deleted, only configured. */
const isSavedList = (l: ItemList): boolean => l.name.toLowerCase() === "saved";

/**
 * Item Lists (issue #12): the named groups Save fills, and the Boosting
 * Lists that push their not-yet-Known members into Focus Sets. The Default
 * List is where a one-tap Save goes; the built-in Saved list can be
 * configured (even made a Boosting List) but never renamed or deleted.
 */
function ItemListsSettings({ client }: { client: ApiClient }) {
  const lists = useItemLists(client);
  const { state } = lists;
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<ItemList | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

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

  const addList = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await run(() => lists.createList({ name, boosting: false }))) setNewName("");
  };

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return;
    if (await run(() => lists.updateList(renaming.id, { name }))) setRenaming(null);
  };

  const remove = async (l: ItemList) => {
    setConfirmingDelete(null);
    await run(() => lists.deleteList(l.id));
  };

  return (
    <section>
      <h2>Item Lists</h2>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && (
        <>
          <p>Cannot load your Item Lists: {state.message}</p>
          <button type="button" onClick={lists.reload}>
            Retry
          </button>
        </>
      )}
      {state.status === "ready" && (
        <>
          {error && <p role="alert">{error}</p>}
          <p>
            Saving a word from a story adds it to the Default List. A Boosting List also pulls
            its not-yet-known items into your stories&apos; Focus Sets.
          </p>
          <ul>
            {state.lists.map((l) => (
              <li key={l.id}>
                {renaming?.id === l.id ? (
                  <form onSubmit={(e) => void rename(e)} className="inline-form">
                    <input
                      name="listName"
                      aria-label="New name"
                      maxLength={60}
                      value={renameValue}
                      disabled={busy}
                      onChange={(e) => setRenameValue(e.target.value)}
                    />{" "}
                    <button type="submit" disabled={busy || renameValue.trim() === ""}>
                      Save name
                    </button>{" "}
                    <button type="button" onClick={() => setRenaming(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <strong>{l.name}</strong>
                    {l.isDefault && " — default"} · {l.itemCount}{" "}
                    {l.itemCount === 1 ? "item" : "items"}
                    <div>
                      <label>
                        <input
                          type="checkbox"
                          checked={l.boosting}
                          disabled={busy}
                          onChange={(e) => void run(() => lists.updateList(l.id, { boosting: e.target.checked }))}
                        />{" "}
                        Boosting
                      </label>{" "}
                      {!l.isDefault && (
                        <button type="button" disabled={busy} onClick={() => void run(() => lists.setDefaultList(l.id))}>
                          Make default
                        </button>
                      )}{" "}
                      {!isSavedList(l) && (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setRenaming(l);
                              setRenameValue(l.name);
                              setError(undefined);
                            }}
                          >
                            Rename
                          </button>{" "}
                          {confirmingDelete === l.id ? (
                            <>
                              <button type="button" disabled={busy} onClick={() => void remove(l)}>
                                Confirm delete
                              </button>{" "}
                              <button type="button" onClick={() => setConfirmingDelete(null)}>
                                Keep
                              </button>
                            </>
                          ) : (
                            <button type="button" disabled={busy} onClick={() => setConfirmingDelete(l.id)}>
                              Delete
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
          <h3>Add a list</h3>
          <form onSubmit={(e) => void addList(e)}>
            <p>
              <label>
                List name
                <input
                  name="newListName"
                  maxLength={60}
                  placeholder="food, travel…"
                  value={newName}
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
            </p>
            <button type="submit" disabled={busy || newName.trim() === ""}>
              Add list
            </button>
          </form>
        </>
      )}
    </section>
  );
}

/**
 * Reading preferences (issue #11, extended by issue #12): the translation
 * blur and the Lookup Menu hold threshold past which a Known Item's lookup
 * becomes a Weak Signal. Kept on the server, so every device reads the same.
 */
function ReadingSettingsSection({ client }: { client: ApiClient }) {
  const reading = useReadingSettings(client);
  const [holdMs, setHoldMs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const stored = reading.state.status === "ready" ? reading.state.settings : null;
  const holdValue = holdMs ?? String(stored?.lookupHoldMs ?? 800);

  const saveHold = async (e: FormEvent) => {
    e.preventDefault();
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
    <section>
      <h2>Reading</h2>
      {reading.state.status === "loading" && <p>Loading…</p>}
      {reading.state.status === "error" && (
        <>
          <p>Cannot load your reading settings: {reading.state.message}</p>
          <button type="button" onClick={reading.reload}>
            Retry
          </button>
        </>
      )}
      {reading.state.status === "ready" && (
        <>
          <p>
            <label>
              <input
                type="checkbox"
                checked={reading.state.settings.blurTranslation}
                disabled={busy}
                onChange={(e) =>
                  void (async () => {
                    setBusy(true);
                    const res = await reading.setBlurTranslation(e.target.checked);
                    setBusy(false);
                    if (!res.ok) setError(res.message);
                  })()
                }
              />{" "}
              Blur sentence translations until clicked
            </label>
          </p>
          <form onSubmit={(e) => void saveHold(e)}>
            <p>
              <label>
                Lookup hold before a Weak Signal (ms, 0–10000)
                <input
                  name="lookupHoldMs"
                  type="number"
                  min={0}
                  max={10000}
                  step={50}
                  value={holdValue}
                  disabled={busy}
                  onChange={(e) => setHoldMs(e.target.value)}
                />
              </label>
            </p>
            <button type="submit" disabled={busy}>
              Save reading settings
            </button>
          </form>
          {saved && (
            <p className="test-result ok" role="status">
              Saved — the reader uses this from the next lookup on.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </section>
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
