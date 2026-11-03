import { Practice } from "../src/Practice.tsx";
import { useSession } from "../src/session.tsx";

// Practice destination (#44): the existing Practice screen, now under the
// router. Its state (session in flight) is per-mount — leaving the tab
// interrupts a session the way switching screens always has.
export default function PracticeRoute() {
  const { client } = useSession();
  return <Practice client={client} />;
}
