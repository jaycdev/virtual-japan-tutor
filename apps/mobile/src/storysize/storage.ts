import * as SecureStore from "expo-secure-store";

import type { StoryTextSizeStorage } from "./store.ts";

/**
 * Per-device persistence for the Story text size — the plan says so
 * explicitly: "Saved per device, like the theme". Settings exposes it per
 * device (plan 5.4). Same shape as the theme storage.
 */
export const storyTextSizeStorage: StoryTextSizeStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    await SecureStore.setItemAsync(key, value);
  },
};
