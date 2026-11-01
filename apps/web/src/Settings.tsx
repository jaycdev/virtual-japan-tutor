import type { AiProvider, AiProviderTestResult, AiTask, ApiClient } from "@vjt/api-client";
import { useAiSettings, type ActionResult } from "@vjt/core";
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
export function Settings({ client }: { client: ApiClient }) {
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
