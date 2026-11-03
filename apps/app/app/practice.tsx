import { router, useLocalSearchParams } from "expo-router";

import { Practice, practiceSeedForStory } from "../src/Practice.tsx";
import { useSession } from "../src/session.tsx";

// Practice destination (#44), Practice redesign wiring (#46): the existing
// Practice screen, now under the router. Its state (session in flight) is
// per-mount — leaving the tab interrupts a session the way switching screens
// always has.
//
// The reader footer links here as /practice?story=<id> ("Practice this
// Story"): with the param the session starts on arrival rather than waiting
// for the Start tap, seeded from the Story id. The session draws from the
// Learner's Focus Set, not from the Story itself (that seeding waits on the
// API, see practiceSeedForStory and backend issue #57) — which is why the
// footer says "this Story" and never "these words". The API only takes an
// integer seed, not a Story reference, so the seed comes from
// practiceSeedForStory.
export default function PracticeRoute() {
  const { client } = useSession();
  const { story } = useLocalSearchParams<{ story?: string | string[] }>();
  const storyId = typeof story === "string" ? story : undefined;
  return (
    <Practice
      client={client}
      seed={storyId === undefined ? undefined : practiceSeedForStory(storyId)}
      onOpenWordLists={() => router.push("/settings/lists")}
    />
  );
}
