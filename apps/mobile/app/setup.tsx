import { useEffect, useState } from "react";
import { router } from "expo-router";

import { SetupWizard } from "../src/SetupWizard.tsx";
import { useSession } from "../src/session.tsx";
import { hasSetupSeen, markSetupSeen } from "../src/firstRun.ts";

// One-time first-run setup (#50): Starting Level, MaruMori and an AI
// provider, three steps, all skippable. app/index.tsx sends a signed-in
// Learner here when GET /starting-level reports the account has never
// chosen a level; the flag is marked on mount, before the Learner can do
// anything, so skipping the flow — or closing the tab mid-way — still
// counts. Afterwards the same settings live only under /settings.
//
// Review B2: the route is guarded too. A deep link (or a stale bookmark)
// to /setup after the flow was already seen falls through to Today rather
// than walking a configured Learner through setup again. Nothing renders
// until the flag is read, so the redirect shows no wizard flash.
export default function SetupRoute() {
  const { client } = useSession();
  const [decision, setDecision] = useState<"checking" | "show" | "leave">("checking");

  useEffect(() => {
    void (async () => {
      if (await hasSetupSeen()) {
        setDecision("leave");
        router.replace("/");
        return;
      }
      await markSetupSeen();
      setDecision("show");
    })();
  }, []);

  if (decision !== "show") return null;

  return (
    <SetupWizard
      client={client}
      onFinish={() => router.replace("/")}
    />
  );
}
