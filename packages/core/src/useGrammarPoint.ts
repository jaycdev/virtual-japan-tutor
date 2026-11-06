import type { ApiClient, GrammarPointDetail } from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import { errorMessage, errorCode, failureText, httpFailureText } from "./errors.ts";
import { useInterfaceLanguage } from "./i18n/context.ts";

export type GrammarPointState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; point: GrammarPointDetail };

export interface GrammarPointRead {
  state: GrammarPointState;
  /** Ask the server for the point again (the detail screen's Reload). */
  reload(): void;
}

/** A finished read, tagged with the id it answers. */
type Settled = { id: number; state: Extract<GrammarPointState, { status: "ready" | "error" }> };


/**
 * One Grammar Point, read by id (issue #49 review S4). The detail screen used
 * to borrow `useGrammar`, which pulls the whole catalogue page on every mount
 * — a screen showing a single point has no use for it. This hook asks for
 * exactly one thing: GET /grammar/points/{id}.
 *
 * The generating wait lives inside that GET (the server writes a missing
 * explanation synchronously, grammar.go), so `loading` is the generating
 * state; a `ready` point whose explanation is still empty means the server's
 * own generation attempt failed — the screen owes the Learner an honest state
 * for that (S1), hence the state stays `ready` rather than pretending error.
 *
 * `id` undefined (a route :id that is not a catalogue id) leaves the read
 * idle without asking the server. Late answers are dropped twice over: the
 * effect's cancellation stops a changed `id`, a `reload` or an unmount from
 * landing at all, and every settled answer carries the id it belongs to, so
 * one that no longer matches the screen never paints. The visible state is
 * derived from those two facts — no setState runs in the effect body.
 */
export function useGrammarPoint(client: ApiClient, id: number | undefined): GrammarPointRead {
  const { language } = useInterfaceLanguage();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    client
      .GET("/grammar/points/{id}", { params: { path: { id: String(id) } } })
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) setSettled({ id, state: { status: "ready", point: data } });
        else
          setSettled({
            id,
            state: {
              status: "error",
              message: errorMessage(language, errorCode(error), error?.message ?? httpFailureText(language, response.status)),
            },
          });
      })
      .catch(() => {
        if (!cancelled) setSettled({ id, state: { status: "error", message: failureText(language) } });
      });
    return () => {
      cancelled = true;
    };
  }, [client, id, attempt, language]);

  const state: GrammarPointState =
    id === undefined
      ? { status: "idle" }
      : settled !== null && settled.id === id
        ? settled.state
        : { status: "loading" };

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, reload };
}
