import { router, type Href } from "expo-router";

import { Today } from "../src/Today.tsx";
import { useSession } from "../src/session.tsx";

// Today (#47), the landing route: the app opens here on Android and web. The
// chrome (#44) already mounts this route inside the Shell, so the tab bar or
// sidebar is around it and its own ScrollView handles the rest.
//
// Navigation stays with the router: the Story card pushes the reader
// (/stories/:id, the same route the Stories screen uses), the Practice CTA
// goes to /practice, and the two ways out of an empty state go to Stories and
// the Item Lists section — the screens where the Learner can actually act.
export default function TodayRoute() {
  const { client } = useSession();
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
