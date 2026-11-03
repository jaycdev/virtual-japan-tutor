import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { ThemeStorage } from "./store.ts";

/**
 * Per-device persistence for the theme choice (ADR-0008: Uniwind does not
 * persist it): localStorage on web, the secure store on Android. The
 * expo-secure-store web build is a stub, hence the platform switch — same
 * shape as the #42 spike's themeStore.
 */
export const themeStorage: ThemeStorage = {
  getItem: async (key) =>
    Platform.OS === "web"
      ? globalThis.localStorage?.getItem(key) ?? null
      : SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
};
