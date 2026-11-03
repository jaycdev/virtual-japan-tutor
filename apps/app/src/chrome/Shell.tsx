import type { ReactNode } from "react";
import { useRouter, usePathname, type Href } from "expo-router";
import { useWindowDimensions, View } from "react-native";

import { useSession } from "../session.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TabBar } from "./TabBar.tsx";
import { activeDestination, isReaderRoute, type Destination } from "./destinations.ts";

/** At/above this viewport width the chrome becomes a left sidebar (issue #44). */
export const SIDEBAR_BREAKPOINT = 1024;

/** Widest the content column grows on large screens; the rest is margin. */
const CONTENT_MAX_WIDTH = 960;

/**
 * The app chrome around every route (issue #44): a bottom tab bar on narrow
 * screens (<1024 px), hidden while a Story/Grammar reader route is open, and a
 * left sidebar (wordmark, destinations, signed-in Learner, Log out) on wide
 * ones, where content is capped at ~960 px. Navigation is the router's: taps
 * push, hardware Back pops, and the selected destination follows the pathname.
 *
 * Mounted by app/_layout.tsx *inside* <App>, so it only exists while signed in
 * (AuthGate swaps the whole tree out for Login/splash/error below it).
 */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const { width } = useWindowDimensions();

  const active = activeDestination(pathname);
  const select = (d: Destination) => {
    if (d.path !== active) router.push(d.path as Href);
  };

  if (width >= SIDEBAR_BREAKPOINT) {
    const username = session.state.status === "signedIn" ? session.state.user.username : "";
    return (
      <View className="flex-1 flex-row bg-background">
        <Sidebar active={active} username={username} onSelect={select} onLogout={() => void session.logout()} />
        <View className="flex-1 px-6 py-2">
          <View className="mx-auto w-full flex-1" style={{ maxWidth: CONTENT_MAX_WIDTH }}>
            {children}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1">{children}</View>
      {!isReaderRoute(pathname) && <TabBar active={active} onSelect={select} />}
    </View>
  );
}
