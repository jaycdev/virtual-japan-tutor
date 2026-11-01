import type { ApiClient, DictionaryEntry } from "@vjt/api-client";
import { useRef, useState } from "react";

/**
 * Cached on-demand dictionary lookups powering the Lookup row (copied from the
 * web reader, issue #11, so both readers behave identically). Pressing a word
 * fetches its entry (keyed by entSeq + the tapped form so the echoed headword
 * and the reading's pitch are right) and caches it; repeat presses and the
 * Dictionary window then need no new request.
 *
 * A FAILED lookup is remembered (as a null entry) only for the current press:
 * `failed` lets the Lookup Menu dim its Dictionary row, while `load` retries
 * the request on the next press — a transient failure must not silence the
 * word forever. This deliberately differs from the web reader, which caches a
 * failure for the whole session (issue #14 review, major 3). `invalidate`
 * forgets a key outright.
 */

export interface EntryLookup {
  load(entSeq: number, surface?: string, reading?: string): void;
  peek(entSeq: number, surface?: string, reading?: string): DictionaryEntry | undefined;
  /** True when the last attempt for this key failed and nothing is cached. */
  failed(entSeq: number, surface?: string, reading?: string): boolean;
  /** Forget a key: the next press fetches it again. */
  invalidate(entSeq: number, surface?: string, reading?: string): void;
}

export function useEntryLookup(client: ApiClient): EntryLookup {
  const [cache, setCache] = useState<Map<string, DictionaryEntry | null>>(() => new Map());
  const inflight = useRef<Set<string>>(new Set());

  const key = (entSeq: number, surface?: string, reading?: string) => `${entSeq}|${surface ?? ""}|${reading ?? ""}`;

  // Plain functions, rebuilt each render: they close over the current `cache`
  // (which a useCallback would have to list as a dependency anyway), and no
  // consumer memoises on their identity. Callers read them freshly — the
  // reader's gesture handlers go through refs.
  const load = (entSeq: number, surface?: string, reading?: string) => {
    const k = key(entSeq, surface, reading);
    const cached = cache.get(k);
    if ((cached !== undefined && cached !== null) || inflight.current.has(k)) return;
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
  };

  const peek = (entSeq: number, surface?: string, reading?: string) => {
    return cache.get(key(entSeq, surface, reading)) ?? undefined;
  };

  const failed = (entSeq: number, surface?: string, reading?: string) => cache.get(key(entSeq, surface, reading)) === null;

  const invalidate = (entSeq: number, surface?: string, reading?: string) => {
    const k = key(entSeq, surface, reading);
    setCache((prev) => {
      if (!prev.has(k)) return prev;
      const next = new Map(prev);
      next.delete(k);
      return next;
    });
  };

  return { load, peek, failed, invalidate };
}
