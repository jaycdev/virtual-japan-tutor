import type { ApiClient, FocusSetItem } from "@vjt/api-client";
import { useEffect, useState } from "react";

/**
 * Chip labels for the Focus Set (issue #47 review B1, moved to @vjt/core in
 * issue #79 so web and mobile read the same words). A kanji chip's itemRef is
 * already the literal; a vocabulary or grammar chip's itemRef is only an id,
 * so the label comes from the two catalogues: GET /dictionary/entries/{entSeq}
 * for the headword and reading, and GET /grammar/points/{id} for the pattern.
 */

/**
 * The Focus Set in their own words (plan 4.3, P7): the API's `kind` reads as
 * the exercise type - "Grammar point", not "Grammar".
 */
export function focusKindWord(kind: FocusSetItem["kind"]): string {
  return kind === "grammar"
    ? "Grammar point"
    : kind === "vocabulary"
      ? "Word"
      : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * A Focus Set item as a chip label before its lookup resolves. The kanji
 * literal is already the label; for vocabulary and grammar `itemRef` is only an
 * id, so it stands in until the lookup supplies the real word or pattern.
 */
export function focusChipLabel(item: FocusSetItem): string {
  return item.kind === "kanji" ? item.itemRef : `${focusKindWord(item.kind)} ${item.itemRef}`;
}

/**
 * A chip cache key. itemRefs are unique per kind (an ent_seq and a grammar
 * point id can be the same digits), so the kind is part of the key.
 */
export function focusChipKey(item: FocusSetItem): string {
  return `${item.kind}:${item.itemRef}`;
}

/** Label resolution for one vocabulary/grammar chip, and null when there is nothing to show. */
export type FocusChipLabel = string | null;

export type FocusLabelResolver = (item: FocusSetItem) => Promise<FocusChipLabel>;

export function createFocusLabelResolver(client: ApiClient): FocusLabelResolver {
  return async (item) => {
    if (item.kind === "vocabulary") {
      const res = await client.GET("/dictionary/entries/{entSeq}", {
        params: { path: { entSeq: item.itemRef } },
      });
      const entry = res.data;
      if (!entry || !entry.found || !entry.headword) return null;
      return entry.reading && entry.reading !== entry.headword
        ? `${entry.headword} (${entry.reading})`
        : entry.headword;
    }
    if (item.kind === "grammar") {
      const res = await client.GET("/grammar/points/{id}", {
        params: { path: { id: item.itemRef } },
      });
      return res.data?.pattern || null;
    }
    return null;
  };
}

/**
 * Resolved labels for the Focus Set chips, cached per ApiClient. The cache lives
 * outside React (a WeakMap on the client) so a re-render or "See all" never
 * refetches words it already knows. A failed lookup caches null and stays the
 * fallback. Callers pass a memoised resolver, so the effect starts once per
 * client and item set.
 */
const labelCaches = new WeakMap<ApiClient, Map<string, Promise<FocusChipLabel>>>();

function labelPromise(
  cache: Map<string, Promise<FocusChipLabel>>,
  resolve: FocusLabelResolver,
  item: FocusSetItem,
): Promise<FocusChipLabel> {
  const key = focusChipKey(item);
  let promise = cache.get(key);
  if (!promise) {
    // The cached promise never rejects: a failed lookup settles to null so the
    // chip can fall back to its id instead of poisoning the cache.
    promise = Promise.resolve()
      .then(() => resolve(item))
      .catch(() => null);
    cache.set(key, promise);
  }
  return promise;
}

/** The resolved label for each chip shown, keyed by focusChipKey; undefined while it resolves. */
export function useFocusChipLabels(
  client: ApiClient,
  items: FocusSetItem[],
  resolve: FocusLabelResolver,
): Record<string, FocusChipLabel | undefined> {
  const [labels, setLabels] = useState<Record<string, FocusChipLabel>>({});
  useEffect(() => {
    let cache = labelCaches.get(client);
    if (!cache) {
      cache = new Map();
      labelCaches.set(client, cache);
    }
    const lookup = cache;
    let live = true;
    for (const item of items) {
      if (item.kind === "kanji") continue;
      const key = focusChipKey(item);
      void labelPromise(lookup, resolve, item).then((label) => {
        if (live) setLabels((prev) => ({ ...prev, [key]: label }));
      });
    }
    return () => {
      live = false;
    };
  }, [client, items, resolve]);
  return labels;
}
