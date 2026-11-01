import type { ApiClient } from "@vjt/api-client";
import { useHealth } from "@vjt/core";

export function App({ client }: { client: ApiClient }) {
  const health = useHealth(client);

  return (
    <main>
      <h1>Virtual Japan Tutor</h1>
      {health.state === "loading" && <p>Checking server…</p>}
      {(health.state === "ok" || health.state === "degraded") && (
        <p>
          Server: {health.health.status}, database: {health.health.database}
        </p>
      )}
      {health.state === "error" && <p>Cannot reach server: {health.message}</p>}
    </main>
  );
}
