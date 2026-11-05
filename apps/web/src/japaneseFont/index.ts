import { useSyncExternalStore } from "react";

import { localKeyValueStore } from "../storage.ts";
import { createJapaneseFontStore, type JapaneseFont } from "./store.ts";

/** Publishes the choice on <html data-japanese-font>; index.css reads it. */
export function applyJapaneseFontToDocument(font: JapaneseFont): void {
  document.documentElement.dataset.japaneseFont = font;
}

export const japaneseFontStore = createJapaneseFontStore(localKeyValueStore, applyJapaneseFontToDocument);

export function useJapaneseFont(): { font: JapaneseFont; setFont: (font: JapaneseFont) => void } {
  const state = useSyncExternalStore(japaneseFontStore.subscribe, japaneseFontStore.getSnapshot);
  return { font: state.font, setFont: japaneseFontStore.setFont };
}
