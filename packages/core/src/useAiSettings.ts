import type {
  AiProvider,
  AiProviderCreate,
  AiProviderTestResult,
  AiProviderUpdate,
  AiTask,
  AiTaskAssignment,
  ApiClient,
} from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { apiFailure, renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";
import type { InterfaceLanguage } from "./i18n/language.ts";

export type AiSettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; providers: AiProvider[]; tasks: AiTaskAssignment[] };

type HeldAiSettingsState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; providers: AiProvider[]; tasks: AiTaskAssignment[] };

/** Outcome of a mutating action; failures carry a message fit to show the Learner. */
export type ActionResult = { ok: true } | { ok: false; message: string };

export interface AiSettings {
  state: AiSettingsState;
  /** Re-fetch providers and task assignments. */
  reload(): void;
  /** `apiKey`: omit/empty = no key. The key is write-only and never comes back. */
  create(input: AiProviderCreate): Promise<ActionResult>;
  /** Only the fields present change. `apiKey` omitted keeps the stored key, `null` removes it. */
  update(id: string, patch: AiProviderUpdate): Promise<ActionResult>;
  /** Fails with a 409 message while the provider is assigned to a task. */
  remove(id: string): Promise<ActionResult>;
  /** Never rejects: an unreachable server is `{ ok: false, message }` like a failing provider. */
  test(id: string): Promise<AiProviderTestResult>;
  /** `providerId: null` leaves the task without a provider. */
  assign(task: AiTask, providerId: string | null): Promise<ActionResult>;
}

/**
 * Runs a request; maps a thrown network error and an API error body to an
 * ActionResult. One-shot: rendered in `lang` at call time for the toast, and
 * these callbacks are never effect dependencies.
 */
async function act(
  run: () => Promise<{ error?: { code?: string; message?: string } | undefined; response: Response }>,
  lang: InterfaceLanguage,
): Promise<ActionResult> {
  try {
    const { error, response } = await run();
    if (response.ok) return { ok: true };
    return { ok: false, message: renderFailure(lang, apiFailure(error, response.status)) };
  } catch {
    return { ok: false, message: renderFailure(lang, UNREACHABLE_FAILURE) };
  }
}

/**
 * State and actions behind the AI Provider settings screen, shared by web and mobile.
 * `client` must be a stable reference and must already authenticate (see `useAuth`).
 */
export function useAiSettings(client: ApiClient): AiSettings {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldAiSettingsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const fetchAll = useCallback(async (): Promise<HeldAiSettingsState> => {
    try {
      const [providers, tasks] = await Promise.all([client.GET("/ai-providers"), client.GET("/ai-tasks")]);
      if (providers.data && tasks.data) {
        return { status: "ready", providers: providers.data, tasks: tasks.data };
      }
      const failed = providers.error ?? tasks.error;
      return { status: "error", failure: apiFailure(failed, providers.response.status) };
    } catch {
      return { status: "error", failure: UNREACHABLE_FAILURE };
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void fetchAll().then((next) => {
      if (!cancelled) setHeld(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchAll, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /** After a successful mutation, refresh without flashing the loading state. */
  const refreshAfter = useCallback(
    async (result: ActionResult): Promise<ActionResult> => {
      if (result.ok) {
        const next = await fetchAll();
        if (next.status === "ready") setHeld(next);
      }
      return result;
    },
    [fetchAll],
  );

  const create = useCallback(
    (input: AiProviderCreate) => act(() => client.POST("/ai-providers", { body: input }), language).then(refreshAfter),
    [client, language, refreshAfter],
  );

  const update = useCallback(
    (id: string, patch: AiProviderUpdate) =>
      act(() => client.PATCH("/ai-providers/{id}", { params: { path: { id } }, body: patch }), language).then(
        refreshAfter,
      ),
    [client, language, refreshAfter],
  );

  const remove = useCallback(
    (id: string) =>
      act(() => client.DELETE("/ai-providers/{id}", { params: { path: { id } } }), language).then(refreshAfter),
    [client, language, refreshAfter],
  );

  const test = useCallback(
    async (id: string): Promise<AiProviderTestResult> => {
      try {
        const { data, error, response } = await client.POST("/ai-providers/{id}/test", {
          params: { path: { id } },
        });
        if (data) return data;
        return { ok: false, latencyMs: 0, message: renderFailure(language, apiFailure(error, response.status)) };
      } catch {
        return { ok: false, latencyMs: 0, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, language],
  );

  const assign = useCallback(
    (task: AiTask, providerId: string | null) =>
      act(
        () =>
          providerId === null
            ? client.DELETE("/ai-tasks/{task}", { params: { path: { task } } })
            : client.PUT("/ai-tasks/{task}", { params: { path: { task } }, body: { providerId } }),
        language,
      ).then(refreshAfter),
    [client, language, refreshAfter],
  );

  const state = useMemo<AiSettingsState>(() => {
    if (held.status !== "error") return held;
    return { status: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);

  return { state, reload, create, update, remove, test, assign };
}
