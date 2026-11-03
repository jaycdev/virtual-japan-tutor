import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useStory } from "@vjt/core";

import { StoryReader } from "../../src/reader/StoryReader.tsx";
import { useSession } from "../../src/session.tsx";
import { InlineError, Skeleton } from "../../src/state/states.tsx";

/**
 * Story reader route (#44): opened by /stories (push) or deep-linked directly.
 * Back is the router's — "Back to stories" pops the stack (Android hardware
 * Back reaches it through StoryReader's useHardwareBack, the overlay hook,
 * whose last branch falls through to this onBack), and on a fresh tab deep
 * link Back replaces with /stories instead of dead-ending. The reader is a
 * real screen now, not an overlay.
 */
export default function StoryRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { client } = useSession();
  const view = useStory(client);

  useEffect(() => {
    void view.openStory(id);
    // Only re-open when the route's Story changes; `view` actions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (view.error) {
    return (
      <View className="flex-1 justify-center p-4">
        <InlineError message={view.error} onRetry={() => void view.openStory(id)} />
      </View>
    );
  }
  if (!view.story || view.story.id !== id) {
    return (
      <View className="flex-1 p-4">
        <Skeleton lines={8} lineHeight={21} />
      </View>
    );
  }
  return (
    <StoryReader
      client={client}
      view={view}
      story={view.story}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/stories"))}
    />
  );
}
