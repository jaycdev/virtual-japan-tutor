import type { ApiClient, FocusSetItem } from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { apiFailure, renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";

/**
 * The Focus Set on its own (plan 4.4 item 4): the Today glance needs the set
 * and nothing else, and `usePractice` only loads it as a side effect of a
 * session. One read of `GET /focus-set`, never rejected — a failure lands in
 * `error` where the screen can show it with a Retry (plan §5).
 *
 * The failure is stored untranslated and rendered in the current Interface
 * Language, so switching languages re-labels it without another fetch (B1).
 */

export type FocusSetView = {
  /** True while the first read is in flight. */
  loading: boolean;
  /** The last failure, or null while the set is (or may be) fine. */
  error: string | null;
  /** The set in Practice's order; null until the first read lands. */
  items: FocusSetItem[] | null;
  /** The set's configured capacity, or null until the first read lands. */
  size: number | null;
  /** Re-read after an error, or to pick up what a Sync or Practice changed. */
  retry(): void;
};


export function useFocusSet(client: ApiClient): FocusSetView {
  const { language } = useInterfaceLanguage();
  const [items, setItems] = useState<FocusSetItem[] | null>(null);
  const [size, setSize] = useState<number | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // No setLoading(true) here (react-hooks/set-state-in-effect): the initial
    // state is already loading, and a retry flips the flag in retry() itself.
    void (async () => {
      try {
        const { data, error: err, response } = await client.GET("/focus-set");
        if (cancelled) return;
        if (data) {
          setItems(data.items);
          setSize(data.size);
          setFailure(null);
        } else setFailure(apiFailure(err, response.status));
      } catch {
        if (!cancelled) setFailure(UNREACHABLE_FAILURE);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setAttempt((n) => n + 1);
  }, []);

  const error = useMemo(
    () => (failure === null ? null : renderFailure(language, failure)),
    [failure, language],
  );

  return { loading, error, items, size, retry };
}
