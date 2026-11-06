// The Interface Language setting (issue #125): which language the app's own
// chrome speaks. Saved per device, exactly like the theme and the Story text
// size; the choices and their parsing live in @vjt/core so both apps agree.
// Only three values exist, and anything else in storage is the default, "en".
//
// Mirrors apps/web/src/interfacelanguage/store.ts; the storage seam is what
// differs (the secure store here, localStorage there).

import { DEFAULT_INTERFACE_LANGUAGE, parseInterfaceLanguage, type InterfaceLanguage } from "@vjt/core";

export const INTERFACE_LANGUAGE_STORAGE_KEY = "vjt.interfaceLanguage";

export interface InterfaceLanguageStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** The same parser the core hook and the web app use: unknown values fall back to "en". */
export { parseInterfaceLanguage };

export interface InterfaceLanguageState {
  language: InterfaceLanguage;
}

export function createInterfaceLanguageStore(
  storage: InterfaceLanguageStorage,
  applyLanguage: (language: InterfaceLanguage) => void = () => {},
) {
  let state: InterfaceLanguageState = { language: DEFAULT_INTERFACE_LANGUAGE };
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

    getSnapshot(): InterfaceLanguageState {
      return state;
    },

    /** Reads the saved choice once. */
    hydrate(): Promise<void> {
      if (!hydrating) {
        hydrating = storage
          .getItem(INTERFACE_LANGUAGE_STORAGE_KEY)
          .then((saved) => {
            state = { language: parseInterfaceLanguage(saved) };
          })
          .catch(() => {
            state = { language: DEFAULT_INTERFACE_LANGUAGE };
          })
          .then(() => {
            applyLanguage(state.language);
            emit();
          });
      }
      return hydrating;
    },

    setLanguage(language: InterfaceLanguage): void {
      // The same value is not a change: no emit, no write.
      if (state.language === language) return;
      state = { language };
      applyLanguage(language);
      emit();
      storage.setItem(INTERFACE_LANGUAGE_STORAGE_KEY, language).catch(() => {
        // Storage refused: the choice lasts this visit only.
      });
    },
  };
}
