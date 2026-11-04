// /practice and /practice?storyId=<id>. The reader's "Practice this Story" link
// lands here with the Story id, and the session starts on arrival, seeded from
// that id (see practiceSeedForStory and backend issue #57: the API takes only a
// seed, so the exercises still come from the Focus Set).
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { practiceSeedForStory } from "@vjt/core";

import { useSession } from "../session/session.tsx";
import { Practice } from "../practice/Practice.tsx";

export function Component() {
  const { client } = useSession();
  const [params] = useSearchParams();
  const storyId = params.get("storyId") || undefined;
  const seed = useMemo(() => (storyId === undefined ? undefined : practiceSeedForStory(storyId)), [storyId]);
  return <Practice client={client} seed={seed} />;
}
