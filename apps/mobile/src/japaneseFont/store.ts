// The Japanese font setting: Serif (default, Noto Serif JP) or Sans (Noto Sans JP).
// Per device, like the Story text size. Mirrors apps/web/src/japaneseFont/store.ts.

export type JapaneseFont = "serif" | "sans";

export const JAPANESE_FONTS: JapaneseFont[] = ["serif", "sans"];

export const DEFAULT_JAPANESE_FONT: JapaneseFont = "serif";

export const JAPANESE_FONT_STORAGE_KEY = "vjt.japaneseFont";

export function parseJapaneseFont(value: string | null): JapaneseFont {
  const font = (value ?? "").trim().toLowerCase();
  return font === "sans" ? "sans" : DEFAULT_JAPANESE_FONT;
}

export interface JapaneseFontStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface JapaneseFontState {
  font: JapaneseFont;
}

export function createJapaneseFontStore(storage: JapaneseFontStorage) {
  let state: JapaneseFontState = { font: DEFAULT_JAPANESE_FONT };
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

    getSnapshot(): JapaneseFontState {
      return state;
    },

    /** Reads the saved choice once. */
    hydrate(): Promise<void> {
      if (!hydrating) {
        hydrating = storage
          .getItem(JAPANESE_FONT_STORAGE_KEY)
          .then((saved) => {
            state = { font: parseJapaneseFont(saved) };
          })
          .catch(() => {
            state = { font: DEFAULT_JAPANESE_FONT };
          })
          .then(() => {
            emit();
          });
      }
      return hydrating;
    },

    setFont(font: JapaneseFont): void {
      state = { font };
      emit();
      storage.setItem(JAPANESE_FONT_STORAGE_KEY, font).catch(() => {
        // Storage refused: the choice lasts this session only.
      });
    },
  };
}
