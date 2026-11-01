import type { TokenStorage } from "@vjt/core";

/**
 * Session token in localStorage. Storage can be unavailable (privacy modes, quota), in which
 * case reads behave as "no token" and writes/clears are ignored rather than crashing the app.
 */
export function localStorageTokenStorage(
  key = "vjt.token",
  store: Storage = window.localStorage,
): TokenStorage {
  return {
    get: async () => {
      try {
        return store.getItem(key);
      } catch {
        return null;
      }
    },
    set: async (token) => {
      store.setItem(key, token);
    },
    clear: async () => {
      try {
        store.removeItem(key);
      } catch {
        // nothing to forget
      }
    },
  };
}
