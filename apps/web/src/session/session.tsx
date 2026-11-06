// The session for the whole web app (ADR-0010: @vjt/core owns the auth machine,
// the app owns how it is shown). useAuth must exist once, above the router, so
// every route shares one ApiClient and one session check. SessionBoundary stands
// between the provider and the router and shows the states that replace the
// whole tree: loading, and "cannot reach the server" with Retry.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ApiClient } from "@vjt/api-client";
import { useAuth, type Auth, type TokenStorage } from "@vjt/core";

import { ErrorState, SkeletonLines } from "../components/states";
import { T } from "../components/Text.tsx";

/**
 * The auth state plus the client it talks through. `endedByChoice` is true from
 * the moment the Learner pressed Log out until the login page has been shown (it
 * calls `clearEndedByChoice`). While it is set, the guard sends the Learner to a
 * plain /login rather than back to the page they left (`next`). Once cleared, a
 * later signed-out visit to a deep link remembers `next` again.
 */
export type Session = Auth & {
  client: ApiClient;
  endedByChoice: boolean;
  clearEndedByChoice: () => void;
};

export const SessionContext = createContext<Session | null>(null);

export function SessionProvider({
  client,
  tokenStorage,
  children,
}: {
  /** Must be created once, outside React, and already point at the API origin. */
  client: ApiClient;
  tokenStorage: TokenStorage;
  children: ReactNode;
}) {
  const auth = useAuth(client, tokenStorage);
  const [endedByChoice, setEndedByChoice] = useState(false);

  const { login: loginRaw, logout: logoutRaw } = auth;
  const login = useCallback(
    (username: string, password: string) => {
      setEndedByChoice(false);
      return loginRaw(username, password);
    },
    [loginRaw],
  );
  const logout = useCallback(async () => {
    setEndedByChoice(true);
    try {
      await logoutRaw();
    } catch (err) {
      // The sign-out did not happen: do not leave the next visit forgetting `next`.
      setEndedByChoice(false);
      throw err;
    }
  }, [logoutRaw]);
  const clearEndedByChoice = useCallback(() => setEndedByChoice(false), []);

  const { state, busy, retry } = auth;
  const session = useMemo<Session>(
    () => ({ state, busy, login, logout, retry, client, endedByChoice, clearEndedByChoice }),
    [state, busy, login, logout, retry, client, endedByChoice, clearEndedByChoice],
  );
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

/** The session for this app (requires a SessionProvider above). */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used under SessionProvider");
  return session;
}

/**
 * Covers the whole app while the stored session is being checked, and when the
 * server cannot be reached. Signed-out and signed-in are the router's business.
 */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const { state, retry } = useSession();
  if (state.status === "loading") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6" aria-busy="true">
        <div className="w-full max-w-sm">
          <SkeletonLines lines={2} />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm">
          <ErrorState message={<><T k="errors.unreachable" />: {state.message}</>} onRetry={retry} />
        </div>
      </div>
    );
  }
  return children;
}
