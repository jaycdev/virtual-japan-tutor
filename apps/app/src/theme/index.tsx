import { useEffect, useSyncExternalStore } from "react";
import { Uniwind, useUniwind } from "uniwind";

import { themeStorage } from "./storage.ts";
import { createThemeStore, type ResolvedTheme, type ThemePreference, type ThemeState } from "./store.ts";

export type { ResolvedTheme, ThemePreference };

const store = createThemeStore(themeStorage);

/**
 * Applies the Learner's colour theme before the app's first render: the root
 * renders nothing until the saved preference is back from storage, so the
 * first frame on screen already has the right palette. Light / Dark / System;
 * `system` is handed to Uniwind, which follows the device live.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => ({ status: "ready" as const, preference: "system" as const }),
  );

  useEffect(() => {
    void store.hydrate();
  }, []);

  useEffect(() => {
    if (state.status === "ready") Uniwind.setTheme(state.preference);
  }, [state.status, state.preference]);

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
