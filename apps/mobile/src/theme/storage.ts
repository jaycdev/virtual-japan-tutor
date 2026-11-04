import * as SecureStore from "expo-secure-store";

import type { ThemeStorage } from "./store.ts";

/**
 * Per-device persistence for the theme choice (ADR-0008: Uniwind does not
 * persist it), in the Android secure store.
 */
export const themeStorage: ThemeStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    await SecureStore.setItemAsync(key, value);
  },
};
