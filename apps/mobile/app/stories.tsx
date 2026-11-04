import { useRouter, type Href } from "expo-router";

import { Stories } from "../src/Stories.tsx";
import { useSession } from "../src/session.tsx";

// Stories destination (#44): the existing Stories screen, with reading moved
// onto the router — opening a Story pushes /stories/:id, so hardware Back pops
// the reader and the chrome can hide the tab bar there.
export default function StoriesRoute() {
  const router = useRouter();
  const { client } = useSession();
  return (
    <Stories
      client={client}
      onOpenStory={(storyId) => router.push(`/stories/${storyId}` as Href)}
    />
  );
}
