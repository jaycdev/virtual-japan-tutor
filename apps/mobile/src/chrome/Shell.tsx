import type { ReactNode } from "react";
import { useRouter, usePathname, type Href } from "expo-router";
import { PortalHost } from "@rn-primitives/portal";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TabBar } from "./TabBar.tsx";
import { activeDestination, isReaderRoute, type Destination } from "./destinations.ts";

/**
 * The app chrome around every route: a bottom tab bar, hidden while a Story or
 * Grammar reader route is open. Navigation is the router's: taps REPLACE
 * between destinations (tabs never stack history, so Back does not walk
 * through visited tabs), detail routes push and pop, and the selected
 * destination follows the pathname.
 *
 * The top safe-area inset is applied here, once, for every screen (#60): on
 * Android the app draws edge to edge, so without it the first element of any
 * screen sits under the status bar. The bottom inset belongs to the tab bar.
 *
 * Mounted by app/_layout.tsx *inside* <App>, so it only exists while signed in
 * (AuthGate swaps the whole tree out for Login/splash/error below it).
 */
export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const active = activeDestination(pathname);
  const select = (d: Destination) => {
    // Top-level taps REPLACE (#44 review): neither push nor navigate keeps
    // tabs out of the history, so both would let Back walk every tab you
    // visited. Replacing the current entry gives native-tab semantics: one
    // entry for the tab area. Detail routes (a section row, opening a Story)
    // keep pushing so their Backs pop normally.
    if (d.path !== active) router.replace(d.path as Href);
  };

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <View className="flex-1">{children}</View>
      {!isReaderRoute(pathname) && <TabBar active={active} onSelect={select} />}
      {/* the reader's Lookup menu and windows portal here (RN Primitives) */}
      <PortalHost />
    </View>
  );
}
