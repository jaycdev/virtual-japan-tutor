// AI Providers (issue #5; ported from apps/mobile AiProvidersSettings): add, edit,
// test and delete OpenAI-compatible endpoints, and choose which one serves each
// AI task. Keys are write-only: a saved key shows as "set" with Replace, and an
// untouched key field keeps it. Deleting a provider a task still uses fails with
// the server's 409 message.
import type { AiProvider, AiProviderTestResult, AiTask } from "@vjt/api-client";
import {
  AI_TASK_LABELS,
  EMPTY_PROVIDER_FORM,
  canSubmitProviderForm,
  isProviderFormTouched,
  providerCreateInput,
  providerFormFor,
  providerSummary,
  providerUpdateInput,
  useAiSettings,
  type ProviderForm,
  type StepSaveOutcome,
  type StepSaveRegistrar,
} from "@vjt/core";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { Note, SaveStatus, SectionBody, Subheading, SwitchField, TextField, type SaveState } from "../parts.tsx";

const TASKS = Object.keys(AI_TASK_LABELS) as AiTask[];

export function AiProvidersSection({ registerSave }: { registerSave?: StepSaveRegistrar }) {
  const { client } = useSession();
  const settings = useAiSettings(client);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [form, setForm] = useState<ProviderForm>(EMPTY_PROVIDER_FORM);
  const [replacingKey, setReplacingKey] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, AiProviderTestResult>>({});
  // Deleting a provider unmounts its confirm buttons: focus goes here (issue #81 review).
  const providersRef = useRef<HTMLHeadingElement>(null);

  const busy = save.kind === "saving";

  const stopEdit = () => {
    setEditing(null);
    setForm(EMPTY_PROVIDER_FORM);
    setReplacingKey(false);
  };

  const startEdit = (provider: AiProvider) => {
    setEditing(provider);
    setForm(providerFormFor(provider));
    setReplacingKey(false);
    setSave({ kind: "idle" });
  };

  // Adds or saves the form. Shared by the submit button and the wizard's Next (review S2).
  const submit = async (): Promise<StepSaveOutcome> => {
    setSave({ kind: "saving" });
    const res = editing
      ? await settings.update(editing.id, providerUpdateInput(form))
      : await settings.create(providerCreateInput(form));
    if (!res.ok) {
      setSave({ kind: "error", message: res.message });
      return "blocked";
    }
    stopEdit();
    setSave({ kind: "saved", message: editing ? "Provider saved." : "Provider added." });
    return "saved";
  };

  // Re-registered after every render, so the wizard submits what the Learner last typed.
  // A touched-but-incomplete form is refused here too: the wizard's Finish must not
  // bypass canSubmitProviderForm (issue #81 review).
  useEffect(() => {
    if (!registerSave) return;
    registerSave(async () => {
      if (!isProviderFormTouched(form)) return "nothing" as const;
      if (!canSubmitProviderForm(form)) {
        setSave({ kind: "error", message: "Fill in the name, base URL and model, or leave the step." });
        return "blocked" as const;
      }
      return submit();
    });
    return () => registerSave(null);
  });

  if (settings.state.status === "loading") return <SkeletonLines lines={3} />;
  if (settings.state.status === "error") {
    return <ErrorState message={`Cannot load settings: ${settings.state.message}`} onRetry={settings.reload} />;
  }

  const { providers, tasks } = settings.state;
  const assignedTasks = (providerId: string): AiTask[] => tasks.filter((t) => t.providerId === providerId).map((t) => t.task);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmitProviderForm(form) || busy) return;
    void submit();
  };

  const test = async (provider: AiProvider) => {
    setTesting(provider.id);
    setResults((r) => {
      const next = { ...r };
      delete next[provider.id];
      return next;
    });
    const result = await settings.test(provider.id);
    setResults((r) => ({ ...r, [provider.id]: result }));
    setTesting(null);
  };

  const remove = async (provider: AiProvider) => {
    setConfirmingDelete(null);
    setSave({ kind: "saving" });
    const res = await settings.remove(provider.id);
    // The confirm buttons unmount either way; the Providers heading takes the
    // focus the clicked button leaves behind (issue #81 review).
    providersRef.current?.focus();
    if (res.ok) {
      setSave({ kind: "saved", message: "Provider deleted." });
      if (editing?.id === provider.id) stopEdit();
    } else setSave({ kind: "error", message: res.message });
  };

  const assign = async (task: AiTask, providerId: string | null) => {
    setSave({ kind: "saving" });
    const res = await settings.assign(task, providerId);
    setSave(res.ok ? { kind: "saved", message: "Assignment saved." } : { kind: "error", message: res.message });
  };

  const keyIsSet = editing?.hasApiKey === true;

  return (
    <SectionBody>
      <div className="flex flex-col gap-3">
        <Subheading ref={providersRef}>Providers</Subheading>
        {providers.length === 0 ? (
          <p className="text-body text-muted-foreground">No providers yet. Add an OpenAI-compatible endpoint below.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {providers.map((provider) => {
              const result = results[provider.id];
              return (
                <li key={provider.id} className="flex flex-col gap-3 p-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-body font-medium text-foreground">{provider.name}</span>
                    <span className="text-small text-muted-foreground">{providerSummary(provider, assignedTasks(provider.id))}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => startEdit(provider)}>
                      Edit {provider.name}
                    </Button>
                    <Button type="button" variant="outline" disabled={busy || testing === provider.id} onClick={() => void test(provider)}>
                      {testing === provider.id ? "Testing…" : `Test connection to ${provider.name}`}
                    </Button>
                    {confirmingDelete === provider.id ? (
                      <>
                        <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove(provider)}>
                          Confirm delete
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => setConfirmingDelete(provider.id)}
                      >
                        Delete {provider.name}
                      </Button>
                    )}
                  </div>
                  {result ? (
                    <p role="status" className={result.ok ? "text-small text-success" : "text-small text-destructive"}>
                      {`${result.message} (${result.latencyMs} ms)`}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Subheading>{editing ? `Edit ${editing.name}` : "Add a provider"}</Subheading>
        <TextField
          id="ai-name"
          label="Name"
          required
          value={form.name}
          disabled={busy}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <TextField
          id="ai-base-url"
          label="Base URL"
          inputMode="url"
          autoComplete="off"
          placeholder="https://api.openai.com/v1 or http://localhost:11434"
          value={form.baseUrl}
          disabled={busy}
          onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
        />
        <TextField
          id="ai-model"
          label="Model"
          autoComplete="off"
          value={form.model}
          disabled={busy}
          onChange={(event) => setForm({ ...form, model: event.target.value })}
        />

        <div className="flex flex-col gap-3">
          {/* No bare "API key" label: the field is "New API key", and the saved-key
              line names itself (issue #81 review). */}
          {keyIsSet && !replacingKey && !form.removeKey ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-body text-foreground">API key set</span>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setReplacingKey(true)}>
                Replace
              </Button>
            </div>
          ) : null}
          {(!keyIsSet || replacingKey) && !form.removeKey ? (
            <TextField
              id="ai-key"
              label="New API key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.apiKey}
              disabled={busy}
              hint={keyIsSet ? "Leave empty to keep the saved key." : "Leave empty if the endpoint needs none."}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          ) : null}
          {keyIsSet ? (
            <SwitchField
              id="ai-remove-key"
              label="Remove the saved key"
              checked={form.removeKey}
              disabled={busy}
              onChange={(removeKey) => setForm({ ...form, removeKey, apiKey: removeKey ? "" : form.apiKey })}
            />
          ) : null}
          {form.removeKey ? <Note>The saved key will be removed when you save.</Note> : null}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy || !canSubmitProviderForm(form)}>
            {editing ? "Save changes" : "Add provider"}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={stopEdit}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-col gap-4">
        <Subheading>Which provider to use</Subheading>
        {TASKS.map((task) => {
          const current = tasks.find((t) => t.task === task)?.providerId ?? null;
          return (
            <div key={task} className="flex flex-col gap-2">
              <span className="text-body font-medium text-foreground">{AI_TASK_LABELS[task]}</span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant={current === null ? "default" : "outline"} aria-pressed={current === null} disabled={busy} onClick={() => void assign(task, null)}>
                  None
                </Button>
                {providers.map((provider) => (
                  <Button
                    key={provider.id}
                    type="button"
                    variant={current === provider.id ? "default" : "outline"}
                    aria-pressed={current === provider.id}
                    disabled={busy}
                    onClick={() => void assign(task, provider.id)}
                  >
                    {provider.name}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <SaveStatus state={save} />
    </SectionBody>
  );
}
