import { router, type Href } from "expo-router";

import { Grammar } from "../src/Grammar.tsx";
import { useSession } from "../src/session.tsx";

// Grammar destination (#49): the catalogue grouped by JLPT level, with search.
// Opening a point pushes /grammar/:id, so hardware Back pops the detail and
// the chrome hides the tab bar there (isReaderRoute in the Shell).
export default function GrammarRoute() {
  const { client } = useSession();
  return <Grammar client={client} onOpenPoint={(pointId) => router.push(`/grammar/${pointId}` as Href)} />;
}
