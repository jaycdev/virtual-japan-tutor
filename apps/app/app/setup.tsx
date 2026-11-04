import { useEffect } from "react";
import { router } from "expo-router";

import { SetupWizard } from "../src/SetupWizard.tsx";
import { useSession } from "../src/session.tsx";
import { markSetupSeen } from "../src/firstRun.ts";

// One-time first-run setup (#50): Starting Level, MaruMori and an AI
// provider, three steps, all skippable. app/index.tsx sends a signed-in
// Learner here the first time this device has ever opened the app; the flag
// is marked on mount, before the Learner can do anything, so skipping the
// flow — or closing the tab mid-way — still counts. Afterwards the same
// settings live only under /settings.
export default function SetupRoute() {
  const { client } = useSession();

  useEffect(() => {
    void markSetupSeen();
  }, []);

  return (
    <SetupWizard
      client={client}
      onFinish={() => router.replace("/")}
    />
  );
}
