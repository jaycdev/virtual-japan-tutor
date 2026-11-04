import type { ReactNode } from "react";
import { useRouter, usePathname, type Href } from "expo-router";
import { PortalHost } from "@rn-primitives/portal";
import { useWindowDimensions, View } from "react-native";

import { useSession } from "../session.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { TabBar } from "./TabBar.tsx";
import { activeDestination, isReaderRoute, type Destination } from "./destinations.ts";

/** At/above this viewport width the chrome becomes a left sidebar (issue #44). */
export const SIDEBAR_BREAKPOINT = 1024;

/**
 * Below this viewport width, reader overlays (the Lookup menu, the word
 * windows, the Save to… sheet) take their bottom-sheet form; at/above it the
 * Lookup menu anchors to its token and the windows are centred cards.
 * This is the overlays' own split (ui-plan.md §4.1), deliberately separate
 * from SIDEBAR_BREAKPOINT above: between 640 and 1024 the chrome is a tab
 * bar while the overlays are already the wide form.
 */
export const OVERLAY_BREAKPOINT = 640;

/** Widest the content column grows on large screens; the rest is margin. */
export const CONTENT_MAX_WIDTH = 960;

/**
 * Widest a run of body prose grows on its own — the reading measure for
 * explanation text and example sentences (~65 characters at body size). The
 * content column may be 960 px, but a 95-character line is hard to track back
 * on (#49 review N2).
 */
export const PROSE_MAX_WIDTH = 560;

/**
 * The app chrome around every route (issue #44): a bottom tab bar on narrow
 * screens (<1024 px), hidden while a Story/Grammar reader route is open, and a
 * left sidebar (wordmark, destinations, signed-in Learner, Log out) on wide
 * ones, where content is capped at ~960 px. Navigation is the router's: taps
 * REPLACE between destinations (tabs never stack history, so Back does not
 * walk through visited tabs), detail routes push and pop, and the selected
 * destination follows the pathname.
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
    // Top-level taps REPLACE (#44 review): neither push nor navigate keeps
    // tabs out of the history — expo-router's navigate still appends a web
    // history entry — so both let Back walk every tab you visited. Replacing
    // the current entry gives native-tab semantics: one entry for the tab
    // area, Back never pages through visited tabs. Detail routes (a section
    // row, opening a Story) keep pushing so their Backs pop normally.
    if (d.path !== active) router.replace(d.path as Href);
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
        {/* the reader's Lookup menu and windows portal here on native (RN Primitives);
            web portals straight to the document, so this only ever holds native content */}
        <PortalHost />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <View className="flex-1">{children}</View>
      {!isReaderRoute(pathname) && <TabBar active={active} onSelect={select} />}
      <PortalHost />
    </View>
  );
}
