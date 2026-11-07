import * as SecureStore from "expo-secure-store";

import type { InterfaceLanguageStorage } from "./store.ts";

/**
 * Per-device persistence for the Interface Language (issue #125): the same
 * Android secure store the theme, the Story text size and the token use.
 * The key is alphanumeric-plus-dot, as SecureStore requires.
 */
export const interfaceLanguageStorage: InterfaceLanguageStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    await SecureStore.setItemAsync(key, value);
  },
};
