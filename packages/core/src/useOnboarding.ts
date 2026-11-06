import type { ApiClient, GrammarReviewItem, StartingLevelStatus } from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { apiFailure, renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";

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

/** Held variants: the error carries a Failure, rendered at return time (B1). */
type HeldStartingLevelState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; level: StartingLevelStatus };

type HeldGrammarReviewState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; items: GrammarReviewItem[] };

/**
 * State and actions behind the onboarding Starting Level picker (issue #6), shared by
 * web and mobile. `client` must be a stable reference and must already authenticate.
 */
export function useStartingLevel(client: ApiClient): StartingLevelHook {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldStartingLevelState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const fetchStatus = useCallback(async (): Promise<HeldStartingLevelState> => {
    try {
      const { data, error, response } = await client.GET("/starting-level");
      if (data) return { status: "ready", level: data };
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

  const setLevel = useCallback(
    async (level: StartingLevel): Promise<SetLevelOutcome> => {
      try {
        const { data, error, response } = await client.PUT("/starting-level", { body: { level } });
        if (data) {
          setHeld({ status: "ready", level: data });
          return data;
        }
        // One-shot outcome: written in the language of the moment the Learner
        // chose, never re-rendered, so `language` here does not re-run any fetch.
        return { status: "error", message: renderFailure(language, apiFailure(error, response.status)) };
      } catch {
        return { status: "error", message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, language],
  );

  const state = useMemo<StartingLevelState>(() => {
    if (held.status !== "error") return held;
    return { status: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);

  return { state, reload, setLevel };
}

/**
 * The settings "review these" list (issue #6): MaruMori grammar the Catalogue Matching
 * could not resolve cleanly. Loads on demand, like the MaruMori Sync history.
 */
export function useGrammarReview(client: ApiClient): GrammarReview {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldGrammarReviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/grammar/review")
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) setHeld({ status: "ready", items: data });
        else setHeld({ status: "error", failure: apiFailure(error, response.status) });
      })
      .catch(() => {
        if (!cancelled) setHeld({ status: "error", failure: UNREACHABLE_FAILURE });
      });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const state = useMemo<GrammarReviewState>(() => {
    if (held.status !== "error") return held;
    return { status: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);

  return { state, reload };
}
