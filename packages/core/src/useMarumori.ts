import type { ApiClient, MaruMoriStatus, MaruMoriSyncRun } from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { apiFailure, renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";
import type { InterfaceLanguage } from "./i18n/language.ts";

export type MaruMoriState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; marumori: MaruMoriStatus };

export type MaruMoriRunsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; runs: MaruMoriSyncRun[] };

/** The outcome of a Sync request: either the finished run or a readable rejection. */
export type SyncOutcome = MaruMoriSyncRun | { status: "error"; message: string };

export interface MaruMori {
  state: MaruMoriState;
  /** Recent Sync runs, loaded on demand. */
  runs: MaruMoriRunsState;
  /** Re-fetch the status. */
  reload(): void;
  /** Load the recent Sync runs. */
  loadRuns(): void;
  /** Store the API key (write-only; it never comes back). */
  saveKey(apiKey: string): Promise<ActionResult>;
  removeKey(): Promise<ActionResult>;
  /** Trigger a Sync now; never rejects. */
  sync(): Promise<SyncOutcome>;
}

/** Held variants: errors carry a Failure until rendered (B1). */
type HeldMaruMoriState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; marumori: MaruMoriStatus };

type HeldMaruMoriRunsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; runs: MaruMoriSyncRun[] };

/**
 * Runs a request; maps a thrown network error and an API error body to an
 * ActionResult. One-shot: the message is rendered in `lang` at call time,
 * which is right for a toast and never re-runs a fetch.
 */
async function act(
  run: () => Promise<{ error?: { message?: string } | undefined; response: Response }>,
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
 * State and actions behind the MaruMori settings section, shared by web and mobile.
 * `client` must be a stable reference and must already authenticate (see `useAuth`).
 */
export function useMarumori(client: ApiClient): MaruMori {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldMaruMoriState>({ status: "loading" });
  const [heldRuns, setHeldRuns] = useState<HeldMaruMoriRunsState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  const fetchStatus = useCallback(async (): Promise<HeldMaruMoriState> => {
    try {
      const { data, error, response } = await client.GET("/marumori");
      if (data) return { status: "ready", marumori: data };
      return { status: "error", failure: apiFailure(error, response.status) };
    } catch {
      return { status: "error", failure: UNREACHABLE_FAILURE };
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((next) => {
      if (!cancelled) setHeld(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchStatus, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  /** After a successful action, refresh the status without flashing the loading state. */
  const refreshAfter = useCallback(
    async (result: ActionResult): Promise<ActionResult> => {
      if (result.ok) {
        const next = await fetchStatus();
        if (next.status === "ready") setHeld(next);
      }
      return result;
    },
    [fetchStatus],
  );

  const saveKey = useCallback(
    (apiKey: string) => act(() => client.PUT("/marumori/key", { body: { apiKey } }), language).then(refreshAfter),
    [client, language, refreshAfter],
  );

  const removeKey = useCallback(
    () => act(() => client.DELETE("/marumori/key"), language).then(refreshAfter),
    [client, language, refreshAfter],
  );

  const sync = useCallback(async (): Promise<SyncOutcome> => {
    try {
      const { data, error, response } = await client.POST("/marumori/sync");
      if (data) {
        const next = await fetchStatus();
        if (next.status === "ready") setHeld(next);
        return data;
      }
      return { status: "error", message: renderFailure(language, apiFailure(error, response.status)) };
    } catch {
      return { status: "error", message: renderFailure(language, UNREACHABLE_FAILURE) };
    }
  }, [client, language, fetchStatus]);

  const loadRuns = useCallback(() => {
    setHeldRuns({ status: "loading" });
    void client
      .GET("/marumori/syncs")
      .then(({ data, error, response }) => {
        if (data) setHeldRuns({ status: "ready", runs: data });
        else setHeldRuns({ status: "error", failure: apiFailure(error, response.status) });
      })
      .catch(() => setHeldRuns({ status: "error", failure: UNREACHABLE_FAILURE }));
  }, [client]);

  const state = useMemo<MaruMoriState>(() => {
    if (held.status !== "error") return held;
    return { status: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);

  const runs = useMemo<MaruMoriRunsState>(() => {
    if (heldRuns.status !== "error") return heldRuns;
    return { status: "error", message: renderFailure(language, heldRuns.failure) };
  }, [heldRuns, language]);

  return { state, runs, reload, loadRuns, saveKey, removeKey, sync };
}
