// The AI Provider settings form, shared by web and mobile (#5). Keys are
// write-only: an empty key field keeps the stored key, "remove" drops it, and a
// typed key is only ever sent, never shown back. The task names are display
// words in the string table (issue #125); the AiTask ids sent to the server
// never change.

import type { AiProvider, AiProviderCreate, AiProviderUpdate, AiTask } from "@vjt/api-client";
import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./i18n/language.ts";
import { translatePlain } from "./i18n/translate.ts";

export const AI_TASK_LABELS: Record<AiTask, string> = {
  story: translatePlain("en", "aiTask.story"),
  grammar_content: translatePlain("en", "aiTask.grammarContent"),
};

/** An AI task's name in the Learner's Interface Language. */
export function aiTaskLabel(lang: InterfaceLanguage, task: AiTask): string {
  return translatePlain(lang, task === "story" ? "aiTask.story" : "aiTask.grammarContent");
}

export interface ProviderForm {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  removeKey: boolean;
}

export const EMPTY_PROVIDER_FORM: ProviderForm = { name: "", baseUrl: "", model: "", apiKey: "", removeKey: false };

/** The form as it starts when editing a provider: the key field is always blank. */
export function providerFormFor(provider: AiProvider): ProviderForm {
  return { name: provider.name, baseUrl: provider.baseUrl, model: provider.model, apiKey: "", removeKey: false };
}

/** Whether anything has been typed; an untouched form is nothing to save in setup. */
export function isProviderFormTouched(form: ProviderForm): boolean {
  return form.name.trim() !== "" || form.baseUrl.trim() !== "" || form.model.trim() !== "" || form.apiKey.trim() !== "";
}

/** Name, base URL and model are required; the key is optional. */
export function canSubmitProviderForm(form: ProviderForm): boolean {
  return form.name.trim() !== "" && form.baseUrl.trim() !== "" && form.model.trim() !== "";
}

/** The body for POST /ai-providers. An empty key means no key. */
export function providerCreateInput(form: ProviderForm): AiProviderCreate {
  const key = form.apiKey.trim();
  return {
    name: form.name,
    baseUrl: form.baseUrl,
    model: form.model,
    ...(key ? { apiKey: key } : {}),
  };
}

/**
 * The body for PATCH /ai-providers/{id}. An empty key field leaves the stored key
 * alone (the field is left out); "remove" sends null.
 */
export function providerUpdateInput(form: ProviderForm): AiProviderUpdate {
  const key = form.apiKey.trim();
  return {
    name: form.name,
    baseUrl: form.baseUrl,
    model: form.model,
    ...(form.removeKey ? { apiKey: null } : key ? { apiKey: key } : {}),
  };
}

/** One line under a provider: model, endpoint, key state and the tasks it serves. */
export function providerSummary(
  provider: AiProvider,
  assignedTasks: AiTask[],
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  const used =
    assignedTasks.length > 0
      ? ` · ${translatePlain(lang, "settings.ai.usedFor", { tasks: assignedTasks.map((task) => aiTaskLabel(lang, task)).join(", ") })}`
      : "";
  return `${provider.model} at ${provider.baseUrl} · ${translatePlain(lang, provider.hasApiKey ? "settings.ai.keySaved" : "settings.ai.noKey")}${used}`;
}
