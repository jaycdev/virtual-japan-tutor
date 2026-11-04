export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "vjt.theme";

/** Storage seam: the Android secure store (SecureStore). */
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

export function parseThemePreference(value: string | null): ThemePreference {
  return PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : "system";
}

/**
 * @param applyTheme called with the effective preference BEFORE subscribers
 * are notified, on both paths (hydrate and setPreference). Consumers render
 * from the notification, so this ordering guarantees every render happens
 * with the palette already applied - no first-frame theme flash.
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
      return () => listeners.delete(listener);
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
      void storage.setItem(THEME_STORAGE_KEY, preference);
    },
  };
}
