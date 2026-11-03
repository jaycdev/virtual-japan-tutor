import { useEffect, useSyncExternalStore } from "react";
import { Uniwind, useUniwind } from "uniwind";

import { themeStorage } from "./storage.ts";
import { createThemeStore, type ResolvedTheme, type ThemePreference, type ThemeState } from "./store.ts";

export type { ResolvedTheme, ThemePreference };

// Ordering contract: the store calls this BEFORE notifying subscribers, on
// both paths (hydrate: read -> apply -> emit; setPreference: apply -> emit),
// so every render of the app's children happens with the palette already
// applied - the first frame on screen is never the wrong theme.
//
// Native chrome follows the same choice: Uniwind.setTheme drives
// Appearance.setColorScheme on native (uniwind/src/core/config/config.common.ts,
// setTheme), and it is an override, so with a forced Dark on a light-system
// device StatusBar style="auto" and the legacy useColors() (which reads
// react-native's useColorScheme()) both follow the app's choice; "system"
// hands the colour scheme back to the device.
const store = createThemeStore(themeStorage, (preference) => Uniwind.setTheme(preference));

// Stable snapshot for useSyncExternalStore's server path; a fresh object per
// call would break the equality check React relies on.
const SERVER_SNAPSHOT: ThemeState = { status: "ready", preference: "system" };

/**
 * Applies the Learner's colour theme before the app's first render: the root
 * renders nothing until the saved preference is back from storage, and the
 * theme is applied before that first paint. Light / Dark / System; `system`
 * is handed to Uniwind, which follows the device live.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);

  // hydrate() applies the theme before emitting, so the single re-render this
  // triggers already has the right palette; no follow-up effect needed.
  useEffect(() => {
    void store.hydrate();
  }, []);

  if (state.status !== "ready") return null;
  return <>{children}</>;
}

export interface Theme {
  /** What the Learner picked: `light`, `dark`, or `system`. */
  preference: ThemePreference;
  /** What is actually on screen right now. */
  theme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export function useTheme(): Theme {
  const state = useSyncExternalStore<ThemeState>(store.subscribe, store.getSnapshot);
  const { theme } = useUniwind();
  return { preference: state.preference, theme: theme as ResolvedTheme, setPreference: store.setPreference };
}
