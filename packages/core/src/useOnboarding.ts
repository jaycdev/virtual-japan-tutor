import type { ApiClient, GrammarReviewItem, StartingLevelStatus } from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import { FAILED, UNREACHABLE } from "./errors.ts";

export type StartingLevel = "N5" | "N4" | "N3" | "N2" | "N1";

/** The levels in picker order. */
export const STARTING_LEVELS: StartingLevel[] = ["N5", "N4", "N3", "N2", "N1"];

export type StartingLevelState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; level: StartingLevelStatus };

/** The outcome of a level change: the server's counts of Seeded Grammar added/removed. */
export type SetLevelOutcome = StartingLevelStatus | { status: "error"; message: string };

export interface StartingLevelHook {
  state: StartingLevelState;
  /** Re-fetch the status. */
  reload(): void;
  /** Choose or change the Starting Level; never rejects. */
  setLevel(level: StartingLevel): Promise<SetLevelOutcome>;
}

export type GrammarReviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: GrammarReviewItem[] };

export interface GrammarReview {
  state: GrammarReviewState;
  /** Re-fetch the list. */
  reload(): void;
}


/**
 * State and actions behind the onboarding Starting Level picker (issue #6), shared by
 * web and mobile. `client` must be a stable reference and must already authenticate.
 */
export function useStartingLevel(client: ApiClient): StartingLevelHook {
  const [state, setState] = useState<StartingLevelState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const fetchStatus = useCallback(async (): Promise<StartingLevelState> => {
    try {
      const { data, error, response } = await client.GET("/starting-level");
      if (data) return { status: "ready", level: data };
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

  const setLevel = useCallback(
    async (level: StartingLevel): Promise<SetLevelOutcome> => {
      try {
        const { data, error, response } = await client.PUT("/starting-level", { body: { level } });
        if (data) {
          setState({ status: "ready", level: data });
          return data;
        }
        return { status: "error", message: error?.message ?? `${FAILED} (${response.status})` };
      } catch {
        return { status: "error", message: UNREACHABLE };
      }
    },
    [client],
  );

  return { state, reload, setLevel };
}

/**
 * The settings "review these" list (issue #6): MaruMori grammar the Catalogue Matching
 * could not resolve cleanly. Loads on demand, like the MaruMori Sync history.
 */
export function useGrammarReview(client: ApiClient): GrammarReview {
  const [state, setState] = useState<GrammarReviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/grammar/review")
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) setState({ status: "ready", items: data });
        else setState({ status: "error", message: error?.message ?? `${FAILED} (${response.status})` });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: UNREACHABLE });
      });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, reload };
}
