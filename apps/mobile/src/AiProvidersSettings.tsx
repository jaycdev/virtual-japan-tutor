import type { AiProvider, AiProviderTestResult, AiTask, ApiClient } from "@vjt/api-client";
import { useAiSettings, type ActionResult } from "@vjt/core";
import { useState } from "react";

import { Body, Card, Chip, ChipRow, ErrorText, Field, LinkButton, Muted, PrimaryButton, Row, Screen, Scroll, SectionTitle, StatusText, Title, ToggleRow } from "./ui.tsx";

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

/**
 * AI Providers (issue #5, on mobile for issue #13): full management — add,
 * edit, test and delete OpenAI-compatible endpoints, and choose which one
 * serves each AI task. Same rules as web: keys are write-only (empty field =
 * keep; "Remove the saved key" = drop), and deleting a provider that a task
 * still uses fails with the server's 409 message.
 */
export function AiProvidersSettings({ client, onBack }: { client: ApiClient; onBack: () => void }) {
  const settings = useAiSettings(client);
  const { state } = settings;
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [form, setForm] = useState<FormValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AiProviderTestResult>>({});

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

  const submit = async () => {
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
    state.status === "ready"
      ? state.tasks.filter((t) => t.providerId === providerId).map((t) => TASK_LABELS[t.task])
      : [];

  return (
    <Screen>
      <Scroll>
        <Title text="AI Providers" onBack={onBack} />
        {state.status === "loading" && <Muted text="Loading…" />}
        {state.status === "error" && (
          <>
            <ErrorText text={`Cannot load settings: ${state.message}`} />
            <LinkButton label="Retry" onPress={settings.reload} />
          </>
        )}
        {state.status === "ready" && (
          <>
            {error ? <ErrorText text={error} /> : null}
            {state.providers.length === 0 ? (
              <Muted text="No providers yet. Add an OpenAI-compatible endpoint below." />
            ) : (
              state.providers.map((p) => (
                <Card key={p.id}>
                  <Row
                    label={p.name}
                    hint={`${p.model} at ${p.baseUrl} · ${p.hasApiKey ? "Key saved" : "No key"}${
                      assignedTo(p.id).length > 0 ? ` · used for ${assignedTo(p.id).join(", ")}` : ""
                    }`}
                    last
                  />
                  <ProviderActions
                    testing={testing === p.id}
                    confirming={confirmingDelete === p.id}
                    onEdit={() => startEdit(p)}
                    onTest={() => void test(p)}
                    onDeleteAsk={() => setConfirmingDelete(p.id)}
                    onDeleteConfirm={() => void remove(p)}
                    onDeleteKeep={() => setConfirmingDelete(null)}
                  />
                  {testing === p.id && <Body text="Testing…" />}
                  {results[p.id] && (
                    <StatusText
                      ok={results[p.id].ok}
                      text={`${results[p.id].message} (${results[p.id].latencyMs} ms)`}
                    />
                  )}
                </Card>
              ))
            )}

            <SectionTitle text={editing ? `Edit ${editing.name}` : "Add a provider"} />
            <Field
              label="Name"
              value={form.name}
              onChangeText={(name) => setForm({ ...form, name })}
              disabled={busy}
            />
            <Field
              label="Base URL"
              value={form.baseUrl}
              onChangeText={(baseUrl) => setForm({ ...form, baseUrl })}
              keyboardType="url"
              placeholder="https://api.openai.com/v1 or http://localhost:11434"
              disabled={busy}
            />
            <Field
              label="Model"
              value={form.model}
              onChangeText={(model) => setForm({ ...form, model })}
              disabled={busy}
            />
            <Field
              label="API key"
              value={form.apiKey}
              onChangeText={(apiKey) => setForm({ ...form, apiKey })}
              secure
              placeholder={
                editing?.hasApiKey
                  ? "Key saved — leave empty to keep it"
                  : "Leave empty if the endpoint needs none"
              }
              disabled={busy || form.removeKey}
            />
            {editing?.hasApiKey && (
              <Card>
                <ToggleRow
                  label="Remove the saved key"
                  value={form.removeKey}
                  onToggle={(removeKey) => setForm({ ...form, removeKey, apiKey: "" })}
                  disabled={busy}
                  last
                />
              </Card>
            )}
            <PrimaryButton
              label={editing ? "Save changes" : "Add provider"}
              onPress={() => void submit()}
              disabled={busy || !form.name.trim() || !form.baseUrl.trim() || !form.model.trim()}
            />
            {editing ? <LinkButton label="Cancel" onPress={stopEdit} /> : null}

            <SectionTitle text="Which provider to use" />
            {state.tasks.map((t) => (
              <Card key={t.task}>
                <Body text={TASK_LABELS[t.task]} />
                <ChipRow>
                  <Chip
                    label="None"
                    selected={t.providerId === null}
                    onPress={() => void run(() => settings.assign(t.task, null))}
                  />
                  {state.providers.map((p) => (
                    <Chip
                      key={p.id}
                      label={p.name}
                      selected={t.providerId === p.id}
                      onPress={() => void run(() => settings.assign(t.task, p.id))}
                    />
                  ))}
                </ChipRow>
              </Card>
            ))}
          </>
        )}
      </Scroll>
    </Screen>
  );
}

/** The action rows under a provider card, with inline delete confirm. */
function ProviderActions({
  testing,
  confirming,
  onEdit,
  onTest,
  onDeleteAsk,
  onDeleteConfirm,
  onDeleteKeep,
}: {
  testing: boolean;
  confirming: boolean;
  onEdit: () => void;
  onTest: () => void;
  onDeleteAsk: () => void;
  onDeleteConfirm: () => void;
  onDeleteKeep: () => void;
}) {
  return (
    <>
      <Row
        label="Edit"
        onPress={onEdit}
        last={false}
      />
      <Row
        label={testing ? "Testing…" : "Test connection"}
        onPress={onTest}
        last={false}
      />
      {confirming ? (
        <>
          <Row label="Confirm delete" onPress={onDeleteConfirm} last={false} />
          <Row label="Keep" onPress={onDeleteKeep} last />
        </>
      ) : (
        <Row label="Delete" onPress={onDeleteAsk} last />
      )}
    </>
  );
}
