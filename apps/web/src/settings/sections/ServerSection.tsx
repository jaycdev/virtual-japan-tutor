// Server (ui-plan 4.7): a health check only. The web app is served by the
// server it talks to, so its address is this page's own origin and is not
// editable here (the Android app keeps its address field).
import { useState } from "react";
import { useHealth, useT } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { ErrorState, SkeletonLines } from "../../components/states.tsx";
import { T } from "../../components/Text.tsx";
import { useSession } from "../../session/session.tsx";
import { Fact, Note, SectionBody } from "../parts.tsx";

export function ServerSection() {
  const { client } = useSession();
  // Bumped by "Check again"; keys the health read so it runs again (useHealth fetches on mount).
  const [attempt, setAttempt] = useState(0);
  return (
    <SectionBody>
      <dl className="flex flex-col gap-1">
        <Fact label={<T k="server.addressLabel" />}>{window.location.origin}</Fact>
      </dl>
      <Note><T k="server.addressNote" /></Note>
      <HealthLine key={attempt} client={client} onRecheck={() => setAttempt((n) => n + 1)} />
    </SectionBody>
  );
}

function HealthLine({ client, onRecheck }: { client: ReturnType<typeof useSession>["client"]; onRecheck: () => void }) {
  const { tp } = useT();
  const health = useHealth(client);
  if (health.state === "loading") return <SkeletonLines lines={1} />;
  if (health.state === "error") {
    return <ErrorState message={<T k="server.unreachable" params={{ message: health.message }} />} onRetry={onRecheck} />;
  }
  return (
    <div className="flex flex-col items-start gap-3">
      {health.state === "ok" ? (
        <p role="status" className="text-body text-success">
          <T k="server.healthy" />
        </p>
      ) : (
        <p role="status" className="text-body text-destructive">
          <T
            k="server.answeredBut"
            // The {what} slot takes plain text: table params are never parsed
            // for furigana (issue #125).
            params={{
              what: health.health.database === "unreachable" ? tp("server.dbUnreachable") : tp("server.degradedPart"),
            }}
          />
        </p>
      )}
      <Button type="button" variant="outline" onClick={onRecheck}>
        <T k="server.checkAgain" />
      </Button>
    </div>
  );
}
