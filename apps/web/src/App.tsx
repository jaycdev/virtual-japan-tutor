import type { ApiClient } from "@vjt/api-client";
import { useAuth, useHealth, type Auth, type TokenStorage } from "@vjt/core";
import { useState, type FormEvent } from "react";
import { Settings } from "./Settings.tsx";

export function App({ client, storage }: { client: ApiClient; storage: TokenStorage }) {
  const auth = useAuth(client, storage);
  const { state } = auth;

  return (
    <main>
      <h1>Virtual Japan Tutor</h1>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "error" && (
        <>
          <p>Cannot reach server: {state.message}</p>
          <button type="button" onClick={auth.retry}>
            Retry
          </button>
        </>
      )}
      {state.status === "signedOut" && <LoginForm auth={auth} error={state.error} />}
      {state.status === "signedIn" && (
        <Shell client={client} username={state.user.username} onLogout={auth.logout} />
      )}
    </main>
  );
}

function LoginForm({ auth, error }: { auth: Auth; error: string | undefined }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void auth.login(username, password);
  };

  return (
    <form onSubmit={submit}>
      <p>
        <label>
          Username
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
      </p>
      <p>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
      </p>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={auth.busy}>
        Log in
      </button>
    </form>
  );
}

function Shell({
  client,
  username,
  onLogout,
}: {
  client: ApiClient;
  username: string;
  onLogout: () => Promise<void>;
}) {
  const health = useHealth(client);
  const [page, setPage] = useState<"home" | "settings">("home");

  return (
    <section>
      <nav aria-label="Main">
        <button type="button" aria-current={page === "home" ? "page" : undefined} onClick={() => setPage("home")}>
          Home
        </button>{" "}
        <button type="button" aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage("settings")}>
          Settings
        </button>
      </nav>
      <p>Signed in as {username}</p>
      {page === "settings" && <Settings client={client} />}
      {page === "home" && (
        <>
          {health.state === "loading" && <p>Checking server…</p>}
          {(health.state === "ok" || health.state === "degraded") && (
            <p>
              Server: {health.health.status}, database: {health.health.database}
            </p>
          )}
          {health.state === "error" && <p>Cannot reach server: {health.message}</p>}
        </>
      )}
      <button type="button" onClick={() => void onLogout()}>
        Log out
      </button>
    </section>
  );
}
