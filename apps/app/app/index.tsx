import { useEffect, useRef } from "react";
import { router, type Href } from "expo-router";

import { Today } from "../src/Today.tsx";
import { useSession } from "../src/session.tsx";
import { hasSetupSeen, markSetupSeen } from "../src/firstRun.ts";

// Today (#47), the landing route: the app opens here on Android and web. The
// chrome (#44) already mounts this route inside the Shell, so the tab bar or
// sidebar is around it and its own ScrollView handles the rest.
//
// Navigation stays with the router: the Story card pushes the reader
// (/stories/:id, the same route the Stories screen uses), the Practice CTA
// goes to /practice, and the two ways out of an empty state go to Stories and
// the Item Lists section — the screens where the Learner can actually act.
//
// First-run setup (#50): on the first sign-in on this device, landing here
// replaces straight into /setup. The seen-flag is written before navigating,
// so a Learner who skips the flow or quits it halfway is never asked again
// (and never stuck in a redirect loop).
export default function TodayRoute() {
  const { client, state } = useSession();
  const setupChecked = useRef(false);

  useEffect(() => {
    if (state.status !== "signedIn" || setupChecked.current) return;
    setupChecked.current = true;
    void (async () => {
      if (!(await hasSetupSeen())) {
        await markSetupSeen();
        router.replace("/setup");
      }
    })();
  }, [state.status]);

  return (
    <Today
      client={client}
      onOpenStory={(storyId) => router.push(`/stories/${storyId}` as Href)}
      onOpenPractice={() => router.push("/practice" as Href)}
      onOpenStories={() => router.push("/stories" as Href)}
      onOpenWordLists={() => router.push("/settings/lists" as Href)}
      onOpenMarumoriSettings={() => router.push("/settings/marumori" as Href)}
    />
  );
}
