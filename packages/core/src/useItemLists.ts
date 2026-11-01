import type { ApiClient, ItemList, ItemListCreateRequest } from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";

/**
 * The Learner's Item Lists (issue #12) — named groups of Words, Kanji and
 * Grammar Points. Saving a token from the reader targets the Default List
 * (the built-in Saved list unless the Learner picked another), and Boosting
 * Lists push their not-yet-Known items into Focus Sets. One view serves both
 * the reader's Save flow and the Settings list-management section; mutations
 * re-fetch so the counts and the Default marker stay honest.
 *
 * Like the other hooks this never rejects: failures land in `state` or in the
 * returned ActionResult.
 */

export type ItemListsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lists: ItemList[]; defaultListId: string | null };

export interface ItemListsView {
  state: ItemListsState;
  /** The list a plain Save targets; null until the lists are known. */
  defaultListId: string | null;
  createList(list: ItemListCreateRequest): Promise<ActionResult>;
  updateList(
    listId: string,
    patch: { name?: string; boosting?: boolean },
  ): Promise<ActionResult>;
  deleteList(listId: string): Promise<ActionResult>;
  setDefaultList(listId: string): Promise<ActionResult>;
  /** Re-fetch after an error or an out-of-band change. */
  reload(): void;
}

const UNREACHABLE = "Cannot reach the server";
const FAILED = "Request failed";

function message(error: { message?: string } | undefined, status: number): string {
  return error?.message ?? `${FAILED} (${status})`;
}

export function useItemLists(client: ApiClient): ItemListsView {
  const [state, setState] = useState<ItemListsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error: err, response } = await client.GET("/item-lists");
        if (cancelled) return;
        if (data)
          setState({
            status: "ready",
            lists: data.items ?? [],
            defaultListId: data.defaultListId ?? null,
          });
        else setState({ status: "error", message: message(err, response.status) });
      } catch {
        if (!cancelled) setState({ status: "error", message: UNREACHABLE });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  /** Apply the answer the server just gave us, so every mutation ends on truth. */
  const refresh = useCallback(async (): Promise<ActionResult> => {
    try {
      const { data, error: err, response } = await client.GET("/item-lists");
      if (data)
        setState({
          status: "ready",
          lists: data.items ?? [],
          defaultListId: data.defaultListId ?? null,
        });
      else setState({ status: "error", message: message(err, response.status) });
      return data ? { ok: true } : { ok: false, message: message(err, response.status) };
    } catch {
      return { ok: false, message: UNREACHABLE };
    }
  }, [client]);

  const createList = useCallback(
    async (list: ItemListCreateRequest): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.POST("/item-lists", { body: list });
        if (response.status === 201) return refresh();
        return { ok: false, message: message(err, response.status) };
      } catch {
        return { ok: false, message: UNREACHABLE };
      }
    },
    [client, refresh],
  );

  const updateList = useCallback(
    async (listId: string, patch: { name?: string; boosting?: boolean }): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.PUT("/item-lists/{listId}", {
          path: { listId },
          body: patch,
        });
        if (response.status === 200) return refresh();
        return { ok: false, message: message(err, response.status) };
      } catch {
        return { ok: false, message: UNREACHABLE };
      }
    },
    [client, refresh],
  );

  const deleteList = useCallback(
    async (listId: string): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.DELETE("/item-lists/{listId}", {
          path: { listId },
        });
        if (response.status === 204) return refresh();
        return { ok: false, message: message(err, response.status) };
      } catch {
        return { ok: false, message: UNREACHABLE };
      }
    },
    [client, refresh],
  );

  const setDefaultList = useCallback(
    async (listId: string): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.PUT("/item-lists/default", {
          body: { listId },
        });
        if (response.status === 204) return refresh();
        return { ok: false, message: message(err, response.status) };
      } catch {
        return { ok: false, message: UNREACHABLE };
      }
    },
    [client, refresh],
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const defaultListId = state.status === "ready" ? state.defaultListId : null;

  return { state, defaultListId, createList, updateList, deleteList, setDefaultList, reload };
}
