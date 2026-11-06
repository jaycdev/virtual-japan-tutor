// AI Providers (issue #5; ported from apps/mobile AiProvidersSettings): add, edit,
// test and delete OpenAI-compatible endpoints, and choose which one serves each
// AI task. Keys are write-only: a saved key shows as "set" with Replace, and an
// untouched key field keeps it. Deleting a provider a task still uses fails with
// the server's 409 message.
import type { AiProvider, AiProviderTestResult, AiTask } from "@vjt/api-client";
import {
  AI_TASK_LABELS, // keys only: TASKS below; the labels come from the table via aiTaskLabel
  EMPTY_PROVIDER_FORM,
  aiTaskLabel,
  canSubmitProviderForm,
  isProviderFormTouched,
  providerCreateInput,
  providerFormFor,
  providerSummary,
  providerUpdateInput,
  useAiSettings,
  useT,
  type ProviderForm,
  type StepSaveOutcome,
  type StepSaveRegistrar,
} from "@vjt/core";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { T } from "@/components/Text";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { Note, SaveStatus, SectionBody, Subheading, SwitchField, TextField, type SaveState } from "../parts.tsx";

const TASKS = Object.keys(AI_TASK_LABELS) as AiTask[];

export function AiProvidersSection({ registerSave }: { registerSave?: StepSaveRegistrar }) {
  const { client } = useSession();
  const { language, tp } = useT();
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
    setSave({ kind: "saved", message: tp(editing ? "ai.saved" : "ai.added") });
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
        setSave({ kind: "error", message: tp("ai.formIncomplete") });
        return "blocked" as const;
      }
      return submit();
    });
    return () => registerSave(null);
  });

  if (settings.state.status === "loading") return <SkeletonLines lines={3} />;
  if (settings.state.status === "error") {
    return <ErrorState message={tp("ai.loadFailed", { message: settings.state.message })} onRetry={settings.reload} />;
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
      setSave({ kind: "saved", message: tp("ai.deleted") });
      if (editing?.id === provider.id) stopEdit();
    } else setSave({ kind: "error", message: res.message });
  };

  const assign = async (task: AiTask, providerId: string | null) => {
    setSave({ kind: "saving" });
    const res = await settings.assign(task, providerId);
    setSave(res.ok ? { kind: "saved", message: tp("ai.assignmentSaved") } : { kind: "error", message: res.message });
  };

  const keyIsSet = editing?.hasApiKey === true;

  return (
    <SectionBody>
      <div className="flex flex-col gap-3">
        <Subheading ref={providersRef}>
          <T k="ai.providersHeading" />
        </Subheading>
        {providers.length === 0 ? (
          <p className="text-body text-muted-foreground">
            <T k="ai.empty" />
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {providers.map((provider) => {
              const result = results[provider.id];
              return (
                <li key={provider.id} className="flex flex-col gap-3 p-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-body font-medium text-foreground">{provider.name}</span>
                    <span className="text-small text-muted-foreground">
                      {providerSummary(provider, assignedTasks(provider.id), language)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" disabled={busy} onClick={() => startEdit(provider)}>
                      <T k="ai.editButton" params={{ name: provider.name }} />
                    </Button>
                    <Button type="button" variant="outline" disabled={busy || testing === provider.id} onClick={() => void test(provider)}>
                      {testing === provider.id ? <T k="ai.testing" /> : <T k="ai.testButton" params={{ name: provider.name }} />}
                    </Button>
                    {confirmingDelete === provider.id ? (
                      <>
                        <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove(provider)}>
                          <T k="common.confirmDelete" />
                        </Button>
                        <Button type="button" variant="ghost" onClick={() => setConfirmingDelete(null)}>
                          <T k="stories.deleteKeep" />
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
                        <T k="ai.deleteButton" params={{ name: provider.name }} />
                      </Button>
                    )}
                  </div>
                  {result ? (
                    <p role="status" className={result.ok ? "text-small text-success" : "text-small text-destructive"}>
                      <T k="ai.testResult" params={{ message: result.message, latency: result.latencyMs }} />
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <Subheading>
          {editing ? <T k="ai.editHeading" params={{ name: editing.name }} /> : <T k="ai.addHeading" />}
        </Subheading>
        <TextField
          id="ai-name"
          label={tp("ai.nameLabel")}
          required
          value={form.name}
          disabled={busy}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
        />
        <TextField
          id="ai-base-url"
          label={tp("ai.baseUrlLabel")}
          inputMode="url"
          autoComplete="off"
          placeholder={tp("ai.baseUrlPlaceholder")}
          value={form.baseUrl}
          disabled={busy}
          onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}
        />
        <TextField
          id="ai-model"
          label={tp("ai.modelLabel")}
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
              <span className="text-body text-foreground">
                <T k="ai.keySet" />
              </span>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setReplacingKey(true)}>
                <T k="marumori.replace" />
              </Button>
            </div>
          ) : null}
          {(!keyIsSet || replacingKey) && !form.removeKey ? (
            <TextField
              id="ai-key"
              label={tp("ai.newKeyLabel")}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.apiKey}
              disabled={busy}
              hint={keyIsSet ? tp("ai.keyHintKeep") : tp("ai.keyHintNone")}
              onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
            />
          ) : null}
          {keyIsSet ? (
            <SwitchField
              id="ai-remove-key"
              label={tp("ai.removeKeyLabel")}
              checked={form.removeKey}
              disabled={busy}
              onChange={(removeKey) => setForm({ ...form, removeKey, apiKey: removeKey ? "" : form.apiKey })}
            />
          ) : null}
          {form.removeKey ? (
            <Note>
              <T k="ai.removeKeyNote" />
            </Note>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={busy || !canSubmitProviderForm(form)}>
            {editing ? <T k="ai.saveChanges" /> : <T k="ai.addSubmit" />}
          </Button>
          {editing ? (
            <Button type="button" variant="ghost" onClick={stopEdit}>
              <T k="common.cancel" />
            </Button>
          ) : null}
        </div>
      </form>

      <div className="flex flex-col gap-4">
        <Subheading>
          <T k="ai.assignmentHeading" />
        </Subheading>
        {TASKS.map((task) => {
          const current = tasks.find((t) => t.task === task)?.providerId ?? null;
          return (
            <div key={task} className="flex flex-col gap-2">
              <span className="text-body font-medium text-foreground">{aiTaskLabel(language, task)}</span>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant={current === null ? "default" : "outline"} aria-pressed={current === null} disabled={busy} onClick={() => void assign(task, null)}>
                  <T k="common.none" />
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
