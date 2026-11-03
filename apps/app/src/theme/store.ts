export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "vjt.theme";

/** Platform-split storage (`.native.ts` = SecureStore, `.web.ts` = localStorage). */
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

export function createThemeStore(storage: ThemeStorage) {
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
            state = { status: "ready", preference: parseThemePreference(saved) };
          })
          .catch(() => {
            state = { status: "ready", preference: "system" };
          })
          .then(emit);
      }
      return hydrating;
    },

    setPreference(preference: ThemePreference): void {
      state = { ...state, preference };
      emit();
      void storage.setItem(THEME_STORAGE_KEY, preference);
    },
  };
}
