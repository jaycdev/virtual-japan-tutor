import type { ApiClient, DictionaryEntry } from "@vjt/api-client";
import { useCallback, useRef, useState } from "react";

/**
 * Cached on-demand dictionary lookups powering the Lookup row (copied from the
 * web reader, issue #11, so both readers behave identically). Pressing a word
 * fetches its entry (keyed by entSeq + the tapped form so the echoed headword
 * and the reading's pitch are right) and caches it; repeat presses and the
 * Dictionary window then need no new request. Failures are cached as a null
 * entry too, so pressing a word with no dictionary row hits the server once.
 */

export interface EntryLookup {
  load(entSeq: number, surface?: string, reading?: string): void;
  peek(entSeq: number, surface?: string, reading?: string): DictionaryEntry | undefined;
}

export function useEntryLookup(client: ApiClient): EntryLookup {
  const [cache, setCache] = useState<Map<string, DictionaryEntry | null>>(() => new Map());
  const inflight = useRef<Set<string>>(new Set());

  const key = (entSeq: number, surface?: string, reading?: string) => `${entSeq}|${surface ?? ""}|${reading ?? ""}`;

  const load = useCallback(
    (entSeq: number, surface?: string, reading?: string) => {
      const k = key(entSeq, surface, reading);
      if (cache.has(k) || inflight.current.has(k)) return;
      inflight.current.add(k);
      void (async () => {
        try {
          const { data } = await client.GET("/dictionary/entries/{entSeq}", {
            params: { path: { entSeq: String(entSeq) }, query: { surface, reading } },
          });
          setCache((prev) => new Map(prev).set(k, data ?? null));
        } catch {
          setCache((prev) => new Map(prev).set(k, null));
        } finally {
          inflight.current.delete(k);
        }
      })();
    },
    [client, cache],
  );

  const peek = useCallback(
    (entSeq: number, surface?: string, reading?: string) => {
      return cache.get(key(entSeq, surface, reading)) ?? undefined;
    },
    [cache],
  );

  return { load, peek };
}
