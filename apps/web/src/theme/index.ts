import { useSyncExternalStore } from "react";

import { localKeyValueStore } from "../storage.ts";
import { createThemeStore, resolveTheme, type ThemePreference } from "./store.ts";

/** Puts the `dark` class on <html> for a preference (System follows the OS). */
export function applyThemeToDocument(preference: ThemePreference): void {
  const systemPrefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const dark = resolveTheme(preference, systemPrefersDark) === "dark";
  document.documentElement.classList.toggle("dark", dark);
}

/** The app's one theme store. The no-flash script has already applied the class. */
export const themeStore = createThemeStore(localKeyValueStore, applyThemeToDocument);

/** The saved preference, re-rendering when it changes. */
export function useThemePreference(): { preference: ThemePreference; setPreference: (p: ThemePreference) => void } {
  const state = useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot);
  return { preference: state.preference, setPreference: themeStore.setPreference };
}
