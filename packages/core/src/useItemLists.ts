import type {
  ApiClient,
  ItemList,
  ItemListAddRequest,
  ItemListCreateRequest,
  ItemListMember,
  WeakSignalRequest,
} from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { apiFailure, renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";

/**
 * The Learner's Item Lists (issue #12) — named groups of Words, Kanji and
 * Grammar Points. Saving a token from the reader targets the Default List
 * (the built-in Saved list unless the Learner picked another), and Boosting
 * Lists push their not-yet-Known items into Focus Sets. One view serves both
 * the reader's Save flow and the Settings list-management section; mutations
 * re-fetch so the counts and the Default marker stay honest.
 *
 * Like the other hooks this never rejects: failures land in `state` or in the
 * returned ActionResult. The view's failure is held untranslated and
 * rendered in the current Interface Language, so a language switch needs no
 * refetch; ActionResult messages belong to the call that produced them
 * and are rendered at call time.
 */

export type ItemListsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; lists: ItemList[]; defaultListId: string | null };

type HeldItemListsState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; lists: ItemList[]; defaultListId: string | null };

export interface ItemListsView {
  state: ItemListsState;
  /** The list a plain Save targets; null until the lists are known. */
  defaultListId: string | null;
  createList(list: ItemListCreateRequest): Promise<ActionResult & { list?: ItemList }>;
  updateList(
    listId: string,
    patch: { name?: string; boosting?: boolean },
  ): Promise<ActionResult>;
  deleteList(listId: string): Promise<ActionResult>;
  setDefaultList(listId: string): Promise<ActionResult>;
  /** Save one item into one list; the server may record a Weak Signal. */
  addToList(listId: string, item: ItemListAddRequest): Promise<ActionResult>;
  /** Drop one item from one list; the Practice Record keeps its answers. */
  removeFromList(listId: string, item: ItemListAddRequest): Promise<ActionResult>;
  /**
   * Read one list's members with display labels (list management): kind and
   * ref exactly as writes address them, plus the surface/gloss the server
   * joined from the reference data. The read is capped server-side.
   */
  listItems(listId: string): Promise<ActionResult & { members?: ItemListMember[] }>;
  /**
   * Report reader behaviour (held lookup, opened menu, unblurred sentence) as
   * Weak Signals. The server keeps only signals about the caller's Known
   * Items; one-way traffic, so no re-read follows.
   */
  reportWeakSignals(signals: WeakSignalRequest[]): Promise<ActionResult>;
  /** Re-fetch after an error or an out-of-band change. */
  reload(): void;
}

export function useItemLists(client: ApiClient): ItemListsView {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldItemListsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error: err, response } = await client.GET("/item-lists");
        if (cancelled) return;
        if (data)
          setHeld({
            status: "ready",
            lists: data.items ?? [],
            defaultListId: data.defaultListId ?? null,
          });
        else setHeld({ status: "error", failure: apiFailure(err, response.status) });
      } catch {
        if (!cancelled) setHeld({ status: "error", failure: UNREACHABLE_FAILURE });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  /**
   * Re-read after a mutation. A failed re-read never clobbers what is on
   * screen: the mutation itself succeeded, and flipping a ready view into an
   * error would blank the Learner's lists and call a successful Save a
   * failure. The stale lists stay, and the next reload corrects them.
   */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const { data } = await client.GET("/item-lists");
      if (data)
        setHeld({
          status: "ready",
          lists: data.items ?? [],
          defaultListId: data.defaultListId ?? null,
        });
    } catch {
      // keep the stale view
    }
  }, [client]);

  const createList = useCallback(
    async (list: ItemListCreateRequest): Promise<ActionResult & { list?: ItemList }> => {
      try {
        const { data, error: err, response } = await client.POST("/item-lists", { body: list });
        if (response.status === 201 && data) {
          // Hand back the created list (the reader's inline "Save to a new
          // list" needs its id); the re-read keeps the shared view honest,
          // but the create is settled either way.
          const created = data;
          await refresh();
          return { ok: true, list: created };
        }
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, refresh, language],
  );

  const updateList = useCallback(
    async (listId: string, patch: { name?: string; boosting?: boolean }): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.PUT("/item-lists/{listId}", {
          params: { path: { listId } },
          body: patch,
        });
        if (response.status === 200) {
          await refresh();
          return { ok: true };
        }
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, refresh, language],
  );

  const deleteList = useCallback(
    async (listId: string): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.DELETE("/item-lists/{listId}", {
          params: { path: { listId } },
        });
        if (response.status === 204) {
          await refresh();
          return { ok: true };
        }
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, refresh, language],
  );

  const setDefaultList = useCallback(
    async (listId: string): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.PUT("/item-lists/default", {
          body: { listId },
        });
        if (response.status === 204) {
          await refresh();
          return { ok: true };
        }
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, refresh, language],
  );

  const addToList = useCallback(
    async (listId: string, item: ItemListAddRequest): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.POST("/item-lists/{listId}/items", {
          params: { path: { listId } },
          body: item,
        });
        if (response.status === 204) {
          await refresh();
          return { ok: true };
        }
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, refresh, language],
  );

  const removeFromList = useCallback(
    async (listId: string, item: ItemListAddRequest): Promise<ActionResult> => {
      try {
        const { error: err, response } = await client.DELETE("/item-lists/{listId}/items", {
          params: { path: { listId }, query: { itemKind: item.itemKind, itemRef: item.itemRef } },
        });
        if (response.status === 204) {
          await refresh();
          return { ok: true };
        }
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, refresh, language],
  );

  const listItems = useCallback(
    async (listId: string): Promise<ActionResult & { members?: ItemListMember[] }> => {
      try {
        const { data, error: err, response } = await client.GET("/item-lists/{listId}/items", {
          params: { path: { listId } },
        });
        if (response.status === 200 && data) return { ok: true, members: data.items ?? [] };
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, language],
  );

  const reportWeakSignals = useCallback(
    async (signals: WeakSignalRequest[]): Promise<ActionResult> => {
      if (signals.length === 0) return { ok: true };
      try {
        const { error: err, response } = await client.POST("/weak-signals", {
          body: { signals },
        });
        if (response.status === 204) return { ok: true };
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, language],
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const state = useMemo<ItemListsState>(() => {
    if (held.status !== "error") return held;
    return { status: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);

  const defaultListId = state.status === "ready" ? state.defaultListId : null;

  return {
    state,
    defaultListId,
    createList,
    updateList,
    deleteList,
    setDefaultList,
    addToList,
    removeFromList,
    listItems,
    reportWeakSignals,
    reload,
  };
}
