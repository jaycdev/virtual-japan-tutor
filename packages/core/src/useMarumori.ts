import type { ApiClient, MaruMoriStatus, MaruMoriSyncRun } from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";
import { FAILED, UNREACHABLE } from "./errors.ts";

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


async function act(
  run: () => Promise<{ error?: { message?: string } | undefined; response: Response }>,
): Promise<ActionResult> {
  try {
    const { error, response } = await run();
    if (response.ok) return { ok: true };
    return { ok: false, message: error?.message ?? `${FAILED} (${response.status})` };
  } catch {
    return { ok: false, message: UNREACHABLE };
  }
}

/**
 * State and actions behind the MaruMori settings section, shared by web and mobile.
 * `client` must be a stable reference and must already authenticate (see `useAuth`).
 */
export function useMarumori(client: ApiClient): MaruMori {
  const [state, setState] = useState<MaruMoriState>({ status: "loading" });
  const [runs, setRuns] = useState<MaruMoriRunsState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);

  const fetchStatus = useCallback(async (): Promise<MaruMoriState> => {
    try {
      const { data, error, response } = await client.GET("/marumori");
      if (data) return { status: "ready", marumori: data };
      return { status: "error", message: error?.message ?? `${FAILED} (${response.status})` };
    } catch {
      return { status: "error", message: UNREACHABLE };
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void fetchStatus().then((next) => {
      if (!cancelled) setState(next);
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
        if (next.status === "ready") setState(next);
      }
      return result;
    },
    [fetchStatus],
  );

  const saveKey = useCallback(
    (apiKey: string) => act(() => client.PUT("/marumori/key", { body: { apiKey } })).then(refreshAfter),
    [client, refreshAfter],
  );

  const removeKey = useCallback(
    () => act(() => client.DELETE("/marumori/key")).then(refreshAfter),
    [client, refreshAfter],
  );

  const sync = useCallback(async (): Promise<SyncOutcome> => {
    try {
      const { data, error, response } = await client.POST("/marumori/sync");
      if (data) {
        const next = await fetchStatus();
        if (next.status === "ready") setState(next);
        return data;
      }
      return { status: "error", message: error?.message ?? `${FAILED} (${response.status})` };
    } catch {
      return { status: "error", message: UNREACHABLE };
    }
  }, [client, fetchStatus]);

  const loadRuns = useCallback(() => {
    setRuns({ status: "loading" });
    void client
      .GET("/marumori/syncs")
      .then(({ data, error, response }) => {
        if (data) setRuns({ status: "ready", runs: data });
        else setRuns({ status: "error", message: error?.message ?? `${FAILED} (${response.status})` });
      })
      .catch(() => setRuns({ status: "error", message: UNREACHABLE }));
  }, [client]);

  return { state, runs, reload, loadRuns, saveKey, removeKey, sync };
}
