import type { AiProvider, AiProviderTestResult, ApiClient } from "@vjt/api-client";
import {
  EMPTY_PROVIDER_FORM,
  canSubmitProviderForm,
  isProviderFormTouched,
  providerCreateInput,
  providerFormFor,
  providerSummary,
  providerUpdateInput,
  useAiSettings,
  useT,
  type ActionResult,
  type ProviderForm,
  type StepSaveOutcome,
  type StepSaveRegistrar,
} from "@vjt/core";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { Field } from "./components/ui/Field.tsx";
import { LinkButton } from "./components/ui/LinkButton.tsx";
import { Row } from "./components/ui/Row.tsx";
import { SwitchRow } from "./components/ui/SwitchRow.tsx";
import { T } from "./components/Text.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, Skeleton, SkeletonBar } from "./state/states.tsx";

const EMPTY: ProviderForm = EMPTY_PROVIDER_FORM;

/**
 * AI Providers (#5, on the #50 hub): full management — add, edit, test and
 * delete OpenAI-compatible endpoints, and choose which one serves each AI
 * task. Same rules as web: keys are write-only and the field is masked (an
 * empty field = keep; "Remove the saved key" = drop), and deleting a
 * provider that a task still uses fails with the server's 409 message.
 * First-run setup embeds this same component as its third step, and the
 * wizard's Next/Finish submits a filled form through the `registerSave`
 * contract (S2).
 */
export function AiProvidersSettings({
  client,
  registerSave,
}: {
  client: ApiClient;
  /** Handed the step-save by the setup wizard; absent under the Settings hub. */
  registerSave?: StepSaveRegistrar;
}) {
  const settings = useAiSettings(client);
  const { state } = settings;
  const { language, tp } = useT();
  const [error, setError] = useState<string | undefined>();
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [form, setForm] = useState<ProviderForm>(EMPTY);
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
    setForm(providerFormFor(p));
    setError(undefined);
  };
  const stopEdit = () => {
    setEditing(null);
    setForm(EMPTY);
  };

  const submit = async (): Promise<boolean> => {
    const ok = await run(() =>
      editing ? settings.update(editing.id, providerUpdateInput(form)) : settings.create(providerCreateInput(form)),
    );
    if (ok) stopEdit(); // also drops the typed key from memory
    return ok;
  };

  // S2: the wizard's Next/Finish submits the form the Learner filled in —
  // the same submit the "Add provider"/"Save changes" button runs. An
  // untouched form is "nothing"; a rejected one shows its error here and
  // the wizard stays on the step.
  useEffect(() => {
    if (!registerSave) return;
    registerSave(async (): Promise<StepSaveOutcome> => {
      if (!isProviderFormTouched(form)) return "nothing";
      const ok = await submit();
      return ok ? "saved" : "blocked";
    });
    return () => registerSave(null);
  });

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
    state.status === "ready" ? state.tasks.filter((t) => t.providerId === providerId).map((t) => t.task) : [];

  if (state.status === "loading") {
    return (
      <View className="gap-4">
        <SkeletonBar width="40%" height={24} />
        <Skeleton lines={2} />
        <SkeletonBar width="100%" height={96} />
      </View>
    );
  }
  if (state.status === "error") {
    return (
      <InlineError
        message={<T k="ai.loadFailed" params={{ message: state.message }} />}
        onRetry={settings.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      {error ? <InlineError message={error} /> : null}
      {state.providers.length === 0 ? (
        <T k="ai.empty" className="text-body text-muted-foreground" />
      ) : (
        state.providers.map((p) => (
          <Card key={p.id} padded={false}>
            <Row
              label={p.name}
              hint={providerSummary(p, assignedTo(p.id), language)}
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
            {testing === p.id && (
              <T k="ai.testing" className="px-4 pb-3 text-body text-foreground" />
            )}
            {results[p.id] && (
              <View accessibilityLiveRegion="polite" className="px-4 pb-3">
                <T
                  k="ai.testResult"
                  params={{ message: results[p.id].message, latency: results[p.id].latencyMs }}
                  className={`text-body ${results[p.id].ok ? "text-success" : "text-destructive"}`}
                />
              </View>
            )}
          </Card>
        ))
      )}

      {editing ? (
        <T
          k="ai.editHeading"
          params={{ name: editing.name }}
          className="text-small font-semibold uppercase text-muted-foreground"
        />
      ) : (
        <T k="ai.addHeading" className="text-small font-semibold uppercase text-muted-foreground" />
      )}
      <Field
        label={<T k="ai.nameLabel" className="text-small text-muted-foreground" />}
        value={form.name}
        onChangeText={(name) => setForm({ ...form, name })}
        disabled={busy}
      />
      <Field
        label={<T k="ai.baseUrlLabel" className="text-small text-muted-foreground" />}
        value={form.baseUrl}
        onChangeText={(baseUrl) => setForm({ ...form, baseUrl })}
        keyboardType="url"
        placeholder={tp("ai.baseUrlPlaceholder")}
        disabled={busy}
      />
      <Field
        label={<T k="ai.modelLabel" className="text-small text-muted-foreground" />}
        value={form.model}
        onChangeText={(model) => setForm({ ...form, model })}
        disabled={busy}
      />
      <Field
        label={<T k="marumori.apiKeyHeading" className="text-small text-muted-foreground" />}
        value={form.apiKey}
        onChangeText={(apiKey) => setForm({ ...form, apiKey })}
        secure
        placeholder={
          editing?.hasApiKey
            ? tp("mobile.aiKeySavedPlaceholder")
            : tp("mobile.aiKeyNonePlaceholder")
        }
        disabled={busy || form.removeKey}
      />
      {editing?.hasApiKey && (
        <Card padded={false}>
          <SwitchRow
            label={<T k="ai.removeKeyLabel" className="text-body text-foreground" />}
            value={form.removeKey}
            onToggle={(removeKey) => setForm({ ...form, removeKey, apiKey: "" })}
            disabled={busy}
            last
          />
        </Card>
      )}
      <ActionButton
        label={
          editing ? (
            <T k="ai.saveChanges" className="text-body font-semibold text-primary-foreground" />
          ) : (
            <T k="ai.addSubmit" className="text-body font-semibold text-primary-foreground" />
          )
        }
        onPress={() => void submit()}
        filled
        disabled={busy || !canSubmitProviderForm(form)}
      />
      {editing ? (
        <LinkButton
          label={<T k="common.cancel" className="text-body text-primary" />}
          onPress={stopEdit}
        />
      ) : null}

      <T k="ai.assignmentHeading" className="text-small font-semibold uppercase text-muted-foreground" />
      {state.tasks.map((t) => (
        <Card key={t.task}>
          <T
            k={t.task === "story" ? "aiTask.story" : "aiTask.grammarContent"}
            className="text-body text-foreground"
          />
          <ChipRow>
            <Chip
              label={
                <T
                  k="common.none"
                  className={`text-body ${t.providerId === null ? "font-semibold text-primary" : "text-foreground"}`}
                />
              }
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
    </View>
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
      <Row label={<T k="mobile.aiEdit" className="text-body text-foreground" />} onPress={onEdit} last={false} />
      <Row
        label={
          testing ? (
            <T k="ai.testing" className="text-body text-foreground" />
          ) : (
            <T k="mobile.aiTestConnection" className="text-body text-foreground" />
          )
        }
        onPress={onTest}
        last={false}
      />
      {confirming ? (
        <>
          <Row
            label={<T k="common.confirmDelete" className="text-body text-foreground" />}
            onPress={onDeleteConfirm}
            last={false}
          />
          <Row
            label={<T k="stories.deleteKeep" className="text-body text-foreground" />}
            onPress={onDeleteKeep}
            last
          />
        </>
      ) : (
        <Row
          label={<T k="stories.delete" className="text-body text-foreground" />}
          onPress={onDeleteAsk}
          last
        />
      )}
    </>
  );
}
