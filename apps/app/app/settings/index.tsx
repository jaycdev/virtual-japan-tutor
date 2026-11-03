import { useRouter, type Href } from "expo-router";

import { SettingsHome } from "../../src/SettingsHome.tsx";
import { useSession } from "../../src/session.tsx";

// Settings hub (#44): the menu of sections; each row pushes /settings/:section.
export default function SettingsRoute() {
  const router = useRouter();
  const session = useSession();
  const username = session.state.status === "signedIn" ? session.state.user.username : "";
  return (
    <SettingsHome
      username={username}
      serverUrl={session.serverUrl}
      onLogout={() => void session.logout()}
      onOpenSection={(section) => router.push(`/settings/${section}` as Href)}
    />
  );
}
