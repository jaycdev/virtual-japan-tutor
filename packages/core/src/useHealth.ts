import type { ApiClient, Health } from "@vjt/api-client";
import { useEffect, useMemo, useState } from "react";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { renderFailure, type Failure } from "./i18n/failure.ts";

export type HealthState =
  | { state: "loading" }
  | { state: "ok"; health: Health }
  | { state: "degraded"; health: Health }
  | { state: "error"; message: string };

/** Held state: the failure stays untranslated until it is rendered (B1). */
type HeldHealthState =
  | { state: "loading" }
  | { state: "ok"; health: Health }
  | { state: "degraded"; health: Health }
  | { state: "error"; failure: Failure };

/**
 * Fetches GET /health once on mount. UI-agnostic: shared by web and mobile.
 * The failure is stored in the language-independent shape and re-rendered in
 * the current Interface Language, so a language switch never re-fetches.
 */
export function useHealth(client: ApiClient): HealthState {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldHealthState>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    const set = (next: HeldHealthState) => {
      if (!cancelled) setHeld(next);
    };

    client.GET("/health").then(
      ({ data, error: degraded }) => {
        // `degraded` is the 503 response body (a Health payload), not an exception.
        if (data) set({ state: "ok", health: data });
        else if (degraded) set({ state: "degraded", health: degraded });
        else set({ state: "error", failure: { source: "table", key: "errors.emptyResponse" } });
      },
      (err: unknown) =>
        set({ state: "error", failure: { source: "server", message: err instanceof Error ? err.message : String(err) } }),
    );

    return () => {
      cancelled = true;
    };
  }, [client]);

  return useMemo<HealthState>(() => {
    if (held.state !== "error") return held;
    return { state: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);
}
