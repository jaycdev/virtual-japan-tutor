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
// First-run setup (#50, review B2): the wizard is for Learners who have never
// chosen a Starting Level, not for every device first-boot. The gate reads
// GET /starting-level before deciding: an already-configured Learner (an
// upgrader, an account made on another device, a reinstalled app) has setup
// marked seen and is never nagged; only a genuinely unconfigured Learner is
// replaced into /setup, where the route itself records the flag. A server
// that will not answer is inconclusive — no mark, no redirect, checked again
// on the next launch.
export default function TodayRoute() {
  const { client, state } = useSession();
  const setupChecked = useRef(false);

  useEffect(() => {
    if (state.status !== "signedIn" || setupChecked.current) return;
    setupChecked.current = true;
    void (async () => {
      if (await hasSetupSeen()) return;
      // openapi-fetch resolves HTTP errors instead of throwing, so no payload
      // at all (or a thrown network failure) is the inconclusive case.
      let configured: boolean | undefined;
      try {
        configured = (await client.GET("/starting-level")).data?.configured;
      } catch {
        return; // inconclusive: stay put, decide on the next launch
      }
      if (configured === undefined) return; // inconclusive response
      if (configured) {
        await markSetupSeen(); // known account: never ask again
        return;
      }
      router.replace("/setup");
    })();
  }, [state.status, client]);

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
