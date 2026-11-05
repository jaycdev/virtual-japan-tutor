// The Japanese font setting: Serif (the default, Noto Serif JP) or Sans (Noto
// Sans JP). Saved per device, like the Story text size. The chosen face is
// published on <html data-japanese-font>; index.css maps "sans" onto the
// --font-serif variables, so every `font-serif` class follows the setting.

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

export function createJapaneseFontStore(storage: JapaneseFontStorage, applyFont: (font: JapaneseFont) => void = () => {}) {
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
            applyFont(state.font);
            emit();
          });
      }
      return hydrating;
    },

    setFont(font: JapaneseFont): void {
      state = { font };
      applyFont(font);
      emit();
      storage.setItem(JAPANESE_FONT_STORAGE_KEY, font).catch(() => {
        // Storage refused: the choice lasts this visit only.
      });
    },
  };
}
