import type { ApiClient, GrammarPointDetail } from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";

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

const UNREACHABLE = "Cannot reach the server";
const FAILED = "Request failed";

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
 * idle without asking the server. Late answers are dropped: changing `id`,
 * calling `reload`, or unmounting cancels the in-flight effect, so a stale
 * response can never paint over the current one.
 */
export function useGrammarPoint(client: ApiClient, id: number | undefined): GrammarPointRead {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<GrammarPointState>({ status: "idle" });

  useEffect(() => {
    if (id === undefined) {
      setState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    client
      .GET("/grammar/points/{id}", { params: { path: { id: String(id) } } })
      .then(({ data, error, response }) => {
        if (cancelled) return;
        if (data) setState({ status: "ready", point: data });
        else setState({ status: "error", message: error?.message ?? `${FAILED} (${response.status})` });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: UNREACHABLE });
      });
    return () => {
      cancelled = true;
    };
  }, [client, id, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, reload };
}
