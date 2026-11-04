// The theme preference store (ported from apps/mobile/src/theme/store.ts, #42).
// Light / Dark / System, saved per device in localStorage. The store itself is
// DOM-free: the page passes in the storage and the function that applies the
// preference, so the tests can drive both.

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "vjt.theme";

export interface ThemeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ThemeState {
  /** `loading` until the saved preference has been read back. */
  status: "loading" | "ready";
  preference: ThemePreference;
}

const PREFERENCES: ThemePreference[] = ["light", "dark", "system"];

/** Anything unknown (or a missing value) is System, the default. */
export function parseThemePreference(value: string | null): ThemePreference {
  return PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
}

/** The palette a preference resolves to, given what the OS asks for. */
export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === "system") return systemPrefersDark ? "dark" : "light";
  return preference;
}

/**
 * @param applyTheme called with the effective preference BEFORE subscribers are
 * notified, on both paths (hydrate and setPreference), so every render happens
 * with the palette already applied.
 */
export function createThemeStore(storage: ThemeStorage, applyTheme: (preference: ThemePreference) => void) {
  let state: ThemeState = { status: "loading", preference: "system" };
  const listeners = new Set<() => void>();
  let hydrating: Promise<void> | null = null;

  const emit = () => {
    for (const listener of listeners) listener();
  };

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot(): ThemeState {
      return state;
    },

    /** Reads the saved preference once; resolves when the store is `ready`. */
    hydrate(): Promise<void> {
      if (!hydrating) {
        hydrating = storage
          .getItem(THEME_STORAGE_KEY)
          .then((saved) => {
            const preference = parseThemePreference(saved);
            state = { status: "ready", preference };
            applyTheme(preference);
          })
          .catch(() => {
            state = { status: "ready", preference: "system" };
            applyTheme("system");
          })
          .then(emit);
      }
      return hydrating;
    },

    setPreference(preference: ThemePreference): void {
      state = { ...state, preference };
      applyTheme(preference);
      emit();
      storage.setItem(THEME_STORAGE_KEY, preference).catch(() => {
        // Storage refused (private mode, quota): the choice lasts this visit only.
      });
    },
  };
}
