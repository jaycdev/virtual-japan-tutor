import type { KeyValueStore } from "@vjt/core";

/**
 * Per-device key-value storage on the web (localStorage). Reads and writes never
 * throw: storage can be disabled (privacy modes, blocked cookies), and every
 * caller has a sensible answer when it is unavailable. Session tokens are the
 * exception and live in tokenStorage.ts, where a failed write must surface.
 */
export const localKeyValueStore: KeyValueStore = {
  async getItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Nothing persists; the first-run flag or the preference simply lasts this visit.
    }
  },
};
