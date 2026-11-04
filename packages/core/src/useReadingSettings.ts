import type { ApiClient, ReadingSettings } from "@vjt/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";
import { FAILED, UNREACHABLE } from "./errors.ts";

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
 * Like the other hooks this never rejects: failures land in `state`.
 */

export type ReadingSettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
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

function message(error: { message?: string } | undefined, status: number): string {
  return error?.message ?? `${FAILED} (${status})`;
}

export function useReadingSettings(client: ApiClient): ReadingSettingsView {
  const [state, setState] = useState<ReadingSettingsState>({ status: "loading" });
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
          setState({ status: "ready", settings: data });
        } else setState({ status: "error", message: message(err, response.status) });
      } catch {
        if (!cancelled) setState({ status: "error", message: UNREACHABLE });
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
          setState({ status: "ready", settings: data });
          return { ok: true };
        }
        return { ok: false, message: message(err, response.status) };
      } catch {
        return { ok: false, message: UNREACHABLE };
      }
    },
    [client],
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

  return { state, setBlurTranslation, setLookupHoldMs, reload };
}
