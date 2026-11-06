import type {
  ApiClient,
  GrammarJLPTLevel,
  GrammarPointDetail,
  GrammarPointPage,
  GenerationResult,
} from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { apiFailure, renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";

export type GrammarLevelFilter = GrammarJLPTLevel | "all";
export type GrammarFilter = { level: GrammarLevelFilter; query: string; limit: number; offset: number };

export type GrammarListState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: GrammarPointPage };

export type GrammarDetailState =
  | { status: "idle" }
  | { status: "loading"; id: number }
  | { status: "error"; id: number; message: string }
  | { status: "ready"; point: GrammarPointDetail };

/** Held variants: an error carries a Failure, rendered at return time (B1). */
type HeldGrammarListState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; page: GrammarPointPage };

type HeldGrammarDetailState =
  | { status: "idle" }
  | { status: "loading"; id: number }
  | { status: "error"; id: number; failure: Failure }
  | { status: "ready"; point: GrammarPointDetail };

/** Outcome of generating example sentences; failures carry a message fit to show the Learner. */
export type GenerateOutcome = { ok: true; result: GenerationResult } | { ok: false; message: string };

export interface Grammar {
  state: GrammarListState;
  filter: GrammarFilter;
  /** Changing the level or search restarts the list at the first page. */
  setLevel(level: GrammarLevelFilter): void;
  setQuery(query: string): void;
  setOffset(offset: number): void;
  reload(): void;
  detail: GrammarDetailState;
  /** Opening a point fetches its detail; the server generates a missing explanation on that read. */
  open(id: number): void;
  close(): void;
  saveExplanation(id: number, explanation: string): Promise<ActionResult>;
  /** `count`: how many examples to ask for (the server defaults to 10). */
  generateExamples(id: number, count?: number): Promise<GenerateOutcome>;
  regenerateExplanation(id: number): Promise<ActionResult>;
}

const DEFAULT_LIMIT = 50;

/**
 * State and actions behind the grammar catalogue screen, shared by web and mobile.
 * `client` must be a stable reference and must already authenticate (see `useAuth`).
 * `initial` starts the browse where the screen left it — the screen keeps the
 * Learner's search term and page across list→detail→back (#49 review S3), and
 * this is how they ride into the first read instead of refetching page one.
 *
 * List and detail failures are held untranslated and rendered in the current
 * Interface Language, so switching languages re-labels them without refetching
 * (issue #125 B1). Action outcomes are one-shot and rendered at call time.
 */
export function useGrammar(
  client: ApiClient,
  initial?: { query?: string; offset?: number; level?: GrammarLevelFilter },
): Grammar {
  const { language } = useInterfaceLanguage();
  const [level, setLevelState] = useState<GrammarLevelFilter>(initial?.level ?? "all");
  const [query, setQueryState] = useState(initial?.query ?? "");
  const [offset, setOffsetState] = useState(Math.max(0, initial?.offset ?? 0));
  const [attempt, setAttempt] = useState(0);
  const [held, setHeld] = useState<HeldGrammarListState>({ status: "loading" });
  const [heldDetail, setHeldDetail] = useState<HeldGrammarDetailState>({ status: "idle" });

  const filter: GrammarFilter = { level, query, limit: DEFAULT_LIMIT, offset };

  const fetchPage = useCallback(async (): Promise<HeldGrammarListState> => {
    try {
      const { data, error, response } = await client.GET("/grammar/points", {
        params: {
          query: {
            level: level === "all" ? undefined : level,
            q: query === "" ? undefined : query,
            limit: DEFAULT_LIMIT,
            offset,
          },
        },
      });
      if (data) return { status: "ready", page: data };
      return { status: "error", failure: apiFailure(error, response.status) };
    } catch {
      return { status: "error", failure: UNREACHABLE_FAILURE };
    }
  }, [client, level, query, offset]);

  useEffect(() => {
    let cancelled = false;
    void fetchPage().then((next) => {
      if (!cancelled) setHeld(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setLevel = useCallback((next: GrammarLevelFilter) => {
    setLevelState(next);
    setOffsetState(0);
  }, []);
  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setOffsetState(0);
  }, []);
  const setOffset = useCallback((next: number) => setOffsetState(Math.max(0, next)), []);

  const refreshList = useCallback(async () => {
    const next = await fetchPage();
    if (next.status === "ready") setHeld(next);
  }, [fetchPage]);

  /** Replace the open detail (only when it still shows this point) with the server's newest copy. */
  const applyDetail = useCallback((id: number, point: GrammarPointDetail) => {
    setHeldDetail((prev) => {
      const openId = prev.status === "idle" ? null : prev.status === "ready" ? prev.point.id : prev.id;
      return openId === id ? { status: "ready", point } : prev;
    });
  }, []);

  const open = useCallback(
    (id: number) => {
      setHeldDetail({ status: "loading", id });
      void client
        .GET("/grammar/points/{id}", { params: { path: { id: String(id) } } })
        .then(({ data, error, response }) => {
          if (data) setHeldDetail({ status: "ready", point: data });
          else setHeldDetail({ status: "error", id, failure: apiFailure(error, response.status) });
        })
        .catch(() => setHeldDetail({ status: "error", id, failure: UNREACHABLE_FAILURE }));
    },
    [client],
  );

  const close = useCallback(() => setHeldDetail({ status: "idle" }), []);

  const saveExplanation = useCallback(
    async (id: number, explanation: string): Promise<ActionResult> => {
      try {
        const { data, error, response } = await client.PATCH("/grammar/points/{id}", {
          params: { path: { id: String(id) } },
          body: { explanation },
        });
        if (!data) return { ok: false, message: renderFailure(language, apiFailure(error, response.status)) };
        applyDetail(id, data);
        void refreshList();
        return { ok: true };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    // `language` here is fine: a one-shot ActionResult belongs to the language
    // of the call, and these callbacks are never effect dependencies (B1).
    [client, language, applyDetail, refreshList],
  );

  const generateExamples = useCallback(
    async (id: number, count?: number): Promise<GenerateOutcome> => {
      try {
        const { data, error, response } = await client.POST("/grammar/points/{id}/examples", {
          params: { path: { id: String(id) } },
          body: count === undefined ? {} : { count },
        });
        if (!data) return { ok: false, message: renderFailure(language, apiFailure(error, response.status)) };
        setHeldDetail((prev) =>
          prev.status === "ready" && prev.point.id === id
            ? { status: "ready", point: { ...prev.point, examples: data.examples } }
            : prev,
        );
        void refreshList();
        return { ok: true, result: data };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, language, refreshList],
  );

  const regenerateExplanation = useCallback(
    async (id: number): Promise<ActionResult> => {
      try {
        const { data, error, response } = await client.POST("/grammar/points/{id}/explanation/regenerate", {
          params: { path: { id: String(id) } },
        });
        if (!data) return { ok: false, message: renderFailure(language, apiFailure(error, response.status)) };
        applyDetail(id, data);
        void refreshList();
        return { ok: true };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, language, applyDetail, refreshList],
  );

  const state = useMemo<GrammarListState>(() => {
    if (held.status !== "error") return held;
    return { status: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);

  const detail = useMemo<GrammarDetailState>(() => {
    if (heldDetail.status !== "error") return heldDetail;
    return { status: "error", id: heldDetail.id, message: renderFailure(language, heldDetail.failure) };
  }, [heldDetail, language]);

  return { state, filter, setLevel, setQuery, setOffset, reload, detail, open, close, saveExplanation, generateExamples, regenerateExplanation };
}
