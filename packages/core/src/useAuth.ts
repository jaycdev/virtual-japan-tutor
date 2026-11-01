import type { ApiClient, ApiMiddleware, User } from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import type { TokenStorage } from "./tokenStorage.ts";

export type AuthState =
  | { status: "loading" }
  | { status: "signedOut"; error?: string }
  | { status: "signedIn"; user: User }
  /** The stored session could not be checked (server unreachable). The token is kept. */
  | { status: "error"; message: string };

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
 */
export function useAuth(client: ApiClient, storage: TokenStorage): Auth {
  const [state, setState] = useState<AuthState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const set = (next: AuthState) => {
      if (!cancelled) setState(next);
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
        else set({ status: "error", message: `Server answered ${response.status}` });
      } catch (err) {
        set({ status: "error", message: errorText(err) });
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
          await storage.set(data.token);
          setState({ status: "signedIn", user: data.user });
        } else if (response.status === 429) {
          const secs = response.headers.get("Retry-After");
          setState({
            status: "signedOut",
            error: `Too many attempts. Try again${secs ? ` in ${secs} seconds` : " later"}.`,
          });
        } else {
          setState({ status: "signedOut", error: error?.message ?? "Login failed" });
        }
      } catch {
        setState({ status: "signedOut", error: "Cannot reach the server" });
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
    setState({ status: "signedOut" });
  }, [client, storage]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, busy, login, logout, retry };
}
