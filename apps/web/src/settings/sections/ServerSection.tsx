// Server (ui-plan 4.7): a health check only. The web app is served by the
// server it talks to, so its address is this page's own origin and is not
// editable here (the Android app keeps its address field).
import { useState } from "react";
import { useHealth } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { useSession } from "../../session/session.tsx";
import { Fact, Note, SectionBody } from "../parts.tsx";

export function ServerSection() {
  const { client } = useSession();
  // Bumped by "Check again"; keys the health read so it runs again (useHealth fetches on mount).
  const [attempt, setAttempt] = useState(0);
  return (
    <SectionBody>
      <dl className="flex flex-col gap-1">
        <Fact label="Server address">{window.location.origin}</Fact>
      </dl>
      <Note>The app talks to the server it was loaded from, so there is no address to change here.</Note>
      <HealthLine key={attempt} client={client} onRecheck={() => setAttempt((n) => n + 1)} />
    </SectionBody>
  );
}

function HealthLine({ client, onRecheck }: { client: ReturnType<typeof useSession>["client"]; onRecheck: () => void }) {
  const health = useHealth(client);
  if (health.state === "loading") return <SkeletonLines lines={1} />;
  if (health.state === "error") {
    return <ErrorState message={`Cannot reach the server: ${health.message}`} onRetry={onRecheck} />;
  }
  return (
    <div className="flex flex-col items-start gap-3">
      {health.state === "ok" ? (
        <p role="status" className="text-body text-success">
          The server is reachable and its database is connected.
        </p>
      ) : (
        <p role="status" className="text-body text-destructive">
          The server answered, but {health.health.database === "unreachable" ? "cannot reach its database" : "reports a degraded part"}.
        </p>
      )}
      <Button type="button" variant="outline" onClick={onRecheck}>
        Check again
      </Button>
    </div>
  );
}
