import type { ApiClient } from "@vjt/api-client";
import { STARTING_LEVELS, useAuth, useHealth, useStartingLevel, type Auth, type StartingLevel, type TokenStorage } from "@vjt/core";
import { useState, type FormEvent } from "react";
import { Grammar } from "./Grammar.tsx";
import { Practice } from "./Practice.tsx";
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
  const startingLevel = useStartingLevel(client);
  const [page, setPage] = useState<"home" | "grammar" | "practice" | "settings">("home");

  return (
    <section>
      <nav aria-label="Main">
        <button type="button" aria-current={page === "home" ? "page" : undefined} onClick={() => setPage("home")}>
          Home
        </button>{" "}
        <button type="button" aria-current={page === "grammar" ? "page" : undefined} onClick={() => setPage("grammar")}>
          Grammar
        </button>{" "}
        <button type="button" aria-current={page === "practice" ? "page" : undefined} onClick={() => setPage("practice")}>
          Practice
        </button>{" "}
        <button type="button" aria-current={page === "settings" ? "page" : undefined} onClick={() => setPage("settings")}>
          Settings
        </button>
      </nav>
      <p>Signed in as {username}</p>
      {page === "settings" && <Settings client={client} />}
      {page === "grammar" && <Grammar client={client} />}
      {page === "practice" && <Practice client={client} />}
      {page === "home" && (
        <>
          <Onboarding level={startingLevel} onOpenSettings={() => setPage("settings")} />
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

/**
 * First-run onboarding (issue #6): while no Starting Level is chosen, the home page
 * shows the level picker. The MaruMori key and AI Provider live in Settings.
 */
function Onboarding({
  level,
  onOpenSettings,
}: {
  level: ReturnType<typeof useStartingLevel>;
  onOpenSettings: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  if (level.state.status === "loading") return <p>Loading your Starting Level…</p>;
  if (level.state.status === "error") return <p>Cannot load your Starting Level: {level.state.message}</p>;
  if (level.state.level.configured) return null;

  const choose = async (startingLevel: StartingLevel) => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await level.setLevel(startingLevel);
      if ("status" in res && res.status === "error") setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2>Welcome</h2>
      <p>Choose your starting level. Every Grammar Point at or below it counts as known.</p>
      <p>
        {STARTING_LEVELS.map((l) => (
          <button key={l} type="button" disabled={busy} onClick={() => void choose(l)}>
            {l}
          </button>
        ))}
      </p>
      {error && <p role="alert">{error}</p>}
      <p>
        You can also connect MaruMori and add an AI Provider.{" "}
        <button type="button" onClick={onOpenSettings}>
          Open Settings
        </button>
      </p>
    </section>
  );
}
