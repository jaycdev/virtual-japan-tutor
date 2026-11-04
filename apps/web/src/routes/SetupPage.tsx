// /setup: the first-run setup (ui-plan 4.7, #50). The landing gate sends a
// Learner here; this route records the flag as it is shown (so skipping or
// leaving halfway still counts as seen) and sends a Learner who has already seen
// it back to Today. The steps are in settings/SetupWizard.tsx.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { hasSetupSeen, markSetupSeen } from "@vjt/core";

import { localKeyValueStore } from "../storage.ts";
import { SetupWizard } from "../settings/SetupWizard.tsx";

export function Component() {
  const navigate = useNavigate();
  const [decision, setDecision] = useState<"checking" | "show" | "leave">("checking");
  // A ref, not a cancelled flag: StrictMode runs the effect twice, and the second
  // run must not read the flag this one has just set and bounce the Learner away.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      if (await hasSetupSeen(localKeyValueStore)) {
        setDecision("leave");
        return;
      }
      await markSetupSeen(localKeyValueStore);
      setDecision("show");
    })();
  }, []);

  useEffect(() => {
    if (decision === "leave") navigate("/", { replace: true });
  }, [decision, navigate]);

  if (decision !== "show") return null;
  return <SetupWizard onFinish={() => navigate("/", { replace: true })} />;
}
