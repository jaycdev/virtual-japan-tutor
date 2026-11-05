import { useEffect, useSyncExternalStore } from "react";
import * as SecureStore from "expo-secure-store";

import {
  createJapaneseFontStore,
  DEFAULT_JAPANESE_FONT,
  type JapaneseFont,
  type JapaneseFontState,
} from "./store.ts";

export type { JapaneseFont };

// Module-scope singleton, like the Story text size: one setting for the app.
const store = createJapaneseFontStore({
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
});

const SERVER_SNAPSHOT: JapaneseFontState = { font: DEFAULT_JAPANESE_FONT };

/** Hydrates the saved Japanese font at app start (never gates the first frame). */
export function JapaneseFontProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void store.hydrate();
  }, []);
  return <>{children}</>;
}

/**
 * The Uniwind class names for Japanese text. Both spellings are written out in
 * full so the class scanner sees them; `font-serif` maps to Noto Serif JP and
 * `font-sans` to Noto Sans JP (packages/design native.css).
 */
export interface JapaneseFontClasses {
  font: JapaneseFont;
  setFont: (font: JapaneseFont) => void;
  /** Regular Japanese text. */
  serif: "font-serif" | "font-sans";
  /** Bold Japanese text. */
  serifBold: "font-serif-bold" | "font-sans-bold";
}

export function useJapaneseFont(): JapaneseFontClasses {
  const state = useSyncExternalStore<JapaneseFontState>(store.subscribe, store.getSnapshot, () => SERVER_SNAPSHOT);
  return state.font === "sans"
    ? { font: "sans", setFont: store.setFont, serif: "font-sans", serifBold: "font-sans-bold" }
    : { font: "serif", setFont: store.setFont, serif: "font-serif", serifBold: "font-serif-bold" };
}
