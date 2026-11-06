import type { ApiClient, ApiMiddleware, User } from "@vjt/api-client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useInterfaceLanguage } from "./i18n/context.ts";
import { errorCode } from "./i18n/errorMessages.ts";
import { renderFailure, UNREACHABLE_FAILURE, type Failure } from "./i18n/failure.ts";
import type { TokenStorage } from "./tokenStorage.ts";

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  | { status: "signedIn"; user: User }
  /** The stored session could not be checked (server unreachable). The token is kept. */
  | { status: "error"; message: string };

/** The same state while it is held: failures are stored untranslated. */
type HeldAuthState =
  | { status: "loading" }
  | { status: "signedOut"; error?: Failure }
  | { status: "signedIn"; user: User }
  | { status: "error"; failure: Failure };

export interface Auth {
  state: AuthState;
  /** True while a login request is in flight. */
  busy: boolean;
  /** Failures land in `state` (`signedOut` + `error`); this never rejects. */
  login(username: string, password: string): Promise<void>;
  /** Ends the session on the server (best effort) and always signs out locally. */
  logout(): Promise<void>;
  /** Re-check the stored session after an `error` state. */
  retry(): void;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Session state shared by web and mobile. While mounted it installs client middleware that
 * sends `Authorization: Bearer <token>` (read from `storage`) on every request except login,
 * and signs out + forgets the token whenever the server answers a token-bearing request 401.
 * UI-agnostic: the app decides what to render for each `state.status`.
 *
 * `client` and `storage` must be stable references (create them once, outside components);
 * a new one on every render would restart the session check in a loop.
 *
 * Failures are held untranslated and rendered in the current Interface
 * Language at return time, so switching languages re-labels the session check
 * without re-running it (issue #125).
 */
export function useAuth(client: ApiClient, storage: TokenStorage): Auth {
  const { language } = useInterfaceLanguage();
  const [held, setHeld] = useState<HeldAuthState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const set = (next: HeldAuthState) => {
      if (!cancelled) setHeld(next);
    };

    const middleware: ApiMiddleware = {
      async onRequest({ request, schemaPath }) {
        if (schemaPath === "/auth/login") return undefined;
        const token = await storage.get();
        if (token) request.headers.set("Authorization", `Bearer ${token}`);
        return request;
      },
      async onResponse({ request, response }) {
        // Only a token we sent counts: a 401 from a failed login is not an expired session.
        if (response.status === 401 && request.headers.has("Authorization")) {
          await storage.clear();
          set({ status: "signedOut" });
        }
        return undefined;
      },
    };
    client.use(middleware);

    set({ status: "loading" });
    void (async () => {
      try {
        if (!(await storage.get())) return set({ status: "signedOut" });
        const { data, response } = await client.GET("/me");
        if (data) set({ status: "signedIn", user: data });
        else if (response.status === 401) set({ status: "signedOut" });
        else set({ status: "error", failure: { source: "table", key: "auth.serverAnswered", params: { status: response.status } } });
      } catch (err) {
        // The transport's own words, shown as-is in either language.
        set({ status: "error", failure: { source: "server", message: errorText(err) } });
      }
    })();

    return () => {
      cancelled = true;
      client.eject(middleware);
    };
  }, [client, storage, attempt]);

  const login = useCallback(
    async (username: string, password: string) => {
      setBusy(true);
      try {
        const { data, error, response } = await client.POST("/auth/login", {
          body: { username, password },
        });
        if (data) {
          try {
            await storage.set(data.token);
          } catch {
            // Signing in without being able to remember it would break on the next launch.
            setHeld({ status: "signedOut", error: { source: "table", key: "auth.sessionSaveFailed" } });
            return;
          }
          setHeld({ status: "signedIn", user: data.user });
        } else if (response.status === 429) {
          const secs = response.headers.get("Retry-After");
          setHeld({
            status: "signedOut",
            error: secs
              ? { source: "table", key: "auth.tryAgainIn", params: { secs } }
              : { source: "table", key: "auth.tryAgainLater" },
          });
        } else if (error?.message) {
          setHeld({ status: "signedOut", error: { source: "server", code: errorCode(error), message: error.message } });
        } else {
          setHeld({ status: "signedOut", error: { source: "table", key: "auth.loginFailed" } });
        }
      } catch {
        setHeld({ status: "signedOut", error: UNREACHABLE_FAILURE });
      } finally {
        setBusy(false);
      }
    },
    [client, storage],
  );

  const logout = useCallback(async () => {
    try {
      await client.POST("/auth/logout");
    } catch {
      // Offline: the server session simply expires; we still sign out here.
    }
    await storage.clear();
    setHeld({ status: "signedOut" });
  }, [client, storage]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const state = useMemo<AuthState>(() => {
    switch (held.status) {
      case "signedOut":
        return held.error
          ? { status: "signedOut", error: renderFailure(language, held.error) }
          : { status: "signedOut" };
      case "error":
        return { status: "error", message: renderFailure(language, held.failure) };
      default:
        return held;
    }
  }, [held, language]);

  return { state, busy, login, logout, retry };
}
