import { useLocalSearchParams, useRouter } from "expo-router";

import { GrammarPoint } from "../../src/GrammarPoint.tsx";
import { useSession } from "../../src/session.tsx";

// Grammar point detail (#49): /grammar/:id. The id is parsed here so a route
// that is not a catalogue id reaches the screen as `undefined` and is named
// as such, rather than firing a doomed request.
export default function GrammarPointRoute() {
  const router = useRouter();
  const { client } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pointId = Number(id);
  return (
    <GrammarPoint
      client={client}
      pointId={Number.isInteger(pointId) && pointId > 0 ? pointId : undefined}
      // A fresh-tab deep link has no history to pop: Back then replaces to the
      // grammar catalogue rather than stranding the Learner (the pattern
      // stories/[id].tsx and settings/[section].tsx already use).
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/grammar"))}
    />
  );
}
