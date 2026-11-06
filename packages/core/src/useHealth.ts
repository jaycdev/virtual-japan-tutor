import type { ApiClient, Health } from "@vjt/api-client";
import { useEffect, useState } from "react";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { translatePlain } from "./i18n/translate.ts";

export type HealthState =
  | { state: "loading" }
  | { state: "ok"; health: Health }
  | { state: "degraded"; health: Health }
  | { state: "error"; message: string };

/** Fetches GET /health once on mount. UI-agnostic: shared by web and mobile. */
export function useHealth(client: ApiClient): HealthState {
  const { language } = useInterfaceLanguage();
  const [result, setResult] = useState<HealthState>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    const set = (next: HealthState) => {
      if (!cancelled) setResult(next);
    };

    client.GET("/health").then(
      ({ data, error: degraded }) => {
        // `degraded` is the 503 response body (a Health payload), not an exception.
        if (data) set({ state: "ok", health: data });
        else if (degraded) set({ state: "degraded", health: degraded });
        else set({ state: "error", message: translatePlain(language, "errors.emptyResponse") });
      },
      (err: unknown) =>
        set({ state: "error", message: err instanceof Error ? err.message : String(err) }),
    );

    return () => {
      cancelled = true;
    };
  }, [client, language]);

  return result;
}
