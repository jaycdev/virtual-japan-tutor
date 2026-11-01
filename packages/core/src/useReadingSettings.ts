import type { ApiClient, ReadingSettings } from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";

/**
 * The Learner's reader preferences (issue #11), kept on the server so the
 * reading experience is the same in every session and on every device — the
 * Reading Panel's translation starts blurred or not exactly as the Learner
 * left it. Separate from the Story settings on purpose: those steer future
 * generation; these steer how a story is read right now.
 *
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
  /** Re-fetch after an error. */
  reload(): void;
}

const UNREACHABLE = "Cannot reach the server";
const FAILED = "Request failed";

function message(error: { message?: string } | undefined, status: number): string {
  return error?.message ?? `${FAILED} (${status})`;
}

export function useReadingSettings(client: ApiClient): ReadingSettingsView {
  const [state, setState] = useState<ReadingSettingsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error: err, response } = await client.GET("/reading-settings");
        if (cancelled) return;
        if (data) setState({ status: "ready", settings: data });
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

  const setBlurTranslation = useCallback(
    async (blurTranslation: boolean): Promise<ActionResult> => {
      try {
        const { data, error: err, response } = await client.PUT("/reading-settings", {
          body: { blurTranslation },
        });
        if (data) {
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

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, setBlurTranslation, reload };
}
