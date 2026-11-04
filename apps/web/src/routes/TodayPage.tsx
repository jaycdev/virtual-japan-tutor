// / — the signed-in landing page (plan 4.4, issue #79). The whole screen is the
// Today module; this file only wires it to the session's API client.
import { useSession } from "../session/session.tsx";
import { Today } from "../today/Today.tsx";

export function Component() {
  const { client } = useSession();
  return <Today client={client} />;
}
