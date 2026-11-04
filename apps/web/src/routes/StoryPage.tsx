// /stories/:storyId, the Story reader (ui-plan 4.1). The route opens the Story
// by id and hands it to the reader; the reader remounts per Story (keyed by id),
// so each Story starts with a clean panel and selection.
import { useStory } from "@vjt/core";
import { useEffect } from "react";
import { useParams } from "react-router";

import { ErrorState, SkeletonLines } from "@/components/states";
import { StoryReader } from "../reader/StoryReader.tsx";
import { useSession } from "../session/session.tsx";

export function Component() {
  const { storyId = "" } = useParams();
  const { client } = useSession();
  const view = useStory(client);
  const { openStory, story, error } = view;

  useEffect(() => {
    void openStory(storyId);
  }, [storyId, openStory]);

  if (!story || story.id !== storyId) {
    if (error) return <ErrorState message={error} onRetry={() => void openStory(storyId)} />;
    return <SkeletonLines lines={8} />;
  }
  return <StoryReader key={story.id} client={client} view={view} story={story} />;
}
