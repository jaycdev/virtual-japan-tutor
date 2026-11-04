// Shared client-side state for the route tree (#44).
//
// `useAuth` from @vjt/core must exist once per signed-in session, not once per
// screen: screens need the same ApiClient, and a server-address change has to
// rebuild it. Under the router each screen is its own component, so the auth
// machine lives in this provider, mounted by the root layout above every route.
//
// The old shell rebuilt the whole tree with key={serverUrl} when the address
// changed. Same idea here: this provider is keyed by server URL in the shell,
// so a new address means a new ApiClient and a fresh session check — and the
// token itself is cleared by the shell when it writes a new address.
import { createContext, useContext, useMemo } from "react";
import { createApiClient } from "@vjt/api-client";
import { useAuth, type Auth, type TokenStorage } from "@vjt/core";

export type ApiClient = ReturnType<typeof createApiClient>;

/** The session for the current server, plus the address plumbing that built it. */
export type Session = Auth & {
  client: ApiClient;
  serverUrl: string;
  changeServerUrl: (url: string) => Promise<void>;
};

const AuthContext = createContext<Session | null>(null);

export function AuthProvider({
  serverUrl,
  tokenStorage,
  fetchOverride,
  changeServerUrl,
  children,
}: {
  serverUrl: string;
  tokenStorage: TokenStorage;
  fetchOverride?: typeof globalThis.fetch;
  changeServerUrl: (url: string) => Promise<void>;
  children: React.ReactNode;
}): React.JSX.Element {
  const client = useMemo(
    () => createApiClient({ baseUrl: serverUrl, ...(fetchOverride ? { fetch: fetchOverride } : {}) }),
    [serverUrl, fetchOverride],
  );
  const auth = useAuth(client, tokenStorage);
  return (
    <AuthContext.Provider value={{ ...auth, client, serverUrl, changeServerUrl }}>
      {children}
    </AuthContext.Provider>
  );
}

/** The session for the current server (requires an AuthProvider above). */
export function useSession(): Session {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useSession must be used under AuthProvider");
  return auth;
}
