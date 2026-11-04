// /stories — Today's Story pinned with Generate, and the Story Library with its
// URL-carried filters, persisted layout and pager (plan 4.5, issue #79).
import { useSession } from "../session/session.tsx";
import { Stories } from "../stories/Stories.tsx";

export function Component() {
  const { client } = useSession();
  return <Stories client={client} />;
}
