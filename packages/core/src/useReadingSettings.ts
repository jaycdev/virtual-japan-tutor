import type { ApiClient, ReadingSettings } from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { apiFailure, renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";

/**
 * The Learner's reader preferences (issue #11, extended by issue #12), kept
 * on the server so the reading experience is the same in every session and on
 * every device — the Reading Panel's translation starts blurred or not
 * exactly as the Learner left it, and the Lookup Menu's hold threshold is the
 * one the Learner configured. Separate from the Story settings on purpose:
 * those steer future generation; these steer how a story is read right now.
 *
 * The PUT body carries both fields (the spec requires the whole settings
 * object), so each setter merges with the last settings the server returned.
 * Like the other hooks this never rejects: failures land in `state`, held
 * untranslated and rendered in the current Interface Language (B1).
 */

export type ReadingSettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; settings: ReadingSettings };

type HeldReadingSettingsState =
  | { status: "loading" }
  | { status: "error"; failure: Failure }
  | { status: "ready"; settings: ReadingSettings };

export interface ReadingSettingsView {
  state: ReadingSettingsState;
  /** Persist the blur preference; the server's answer becomes the new state. */
  setBlurTranslation(blur: boolean): Promise<ActionResult>;
  /**
   * Persist the lookup-hold threshold in ms (0 signals every lookup; the
   * server default is 800); the server's answer becomes the new state.
   */
  setLookupHoldMs(ms: number): Promise<ActionResult>;
  /** Re-fetch after an error. */
  reload(): void;
}

// The server's own default, used only if a setter runs before the first
// successful load — in practice unreachable, since only a loaded settings
// panel can call a setter.
const DEFAULT_LOOKUP_HOLD_MS = 800;

export function useReadingSettings(client: ApiClient): ReadingSettingsView {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldReadingSettingsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const last = useRef<ReadingSettings | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error: err, response } = await client.GET("/reading-settings");
        if (cancelled) return;
        if (data) {
          last.current = data;
          setHeld({ status: "ready", settings: data });
        } else setHeld({ status: "error", failure: apiFailure(err, response.status) });
      } catch {
        if (!cancelled) setHeld({ status: "error", failure: UNREACHABLE_FAILURE });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const put = useCallback(
    async (body: ReadingSettings): Promise<ActionResult> => {
      try {
        const { data, error: err, response } = await client.PUT("/reading-settings", { body });
        if (data) {
          last.current = data;
          setHeld({ status: "ready", settings: data });
          return { ok: true };
        }
        // One-shot ActionResult: rendered in the language of the call.
        return { ok: false, message: renderFailure(language, apiFailure(err, response.status)) };
      } catch {
        return { ok: false, message: renderFailure(language, UNREACHABLE_FAILURE) };
      }
    },
    [client, language],
  );

  const current = useCallback(
    (): ReadingSettings =>
      last.current ?? { blurTranslation: true, lookupHoldMs: DEFAULT_LOOKUP_HOLD_MS },
    [],
  );

  const setBlurTranslation = useCallback(
    async (blurTranslation: boolean): Promise<ActionResult> =>
      put({ ...current(), blurTranslation }),
    [put, current],
  );

  const setLookupHoldMs = useCallback(
    async (lookupHoldMs: number): Promise<ActionResult> => put({ ...current(), lookupHoldMs }),
    [put, current],
  );

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const state = useMemo<ReadingSettingsState>(() => {
    if (held.status !== "error") return held;
    return { status: "error", message: renderFailure(language, held.failure) };
  }, [held, language]);

  return { state, setBlurTranslation, setLookupHoldMs, reload };
}
