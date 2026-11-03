import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import type { StoryTextSizeStorage } from "./store.ts";

/**
 * Per-device persistence for the Story text size — the plan says so
 * explicitly: "Saved per device, like the theme (localStorage on web,
 * SecureStore on Android)". Settings will expose it per device (plan 5.4).
 * Same shape as the theme storage.
 */
export const storyTextSizeStorage: StoryTextSizeStorage = {
  getItem: async (key) =>
    Platform.OS === "web"
      ? globalThis.localStorage?.getItem(key) ?? null
      : SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(key, value);
    else await SecureStore.setItemAsync(key, value);
  },
};
