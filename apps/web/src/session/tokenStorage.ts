import type { TokenStorage } from "@vjt/core";

export type { TokenStorage };

/** localStorage key for the session token (same role as the Android secure-store key). */
export const TOKEN_KEY = "vjt.token";

/**
 * The session token in localStorage. Unlike the per-device preferences, a failed
 * write must surface: useAuth turns it into "Could not save the session on this
 * device" instead of signing in without being able to remember it.
 *
 * `storage` is injectable so the tests can use a fake; the default is the page's
 * localStorage, resolved on each call (a disabled store throws there).
 */
export function localTokenStorage(storage: () => Storage = () => window.localStorage): TokenStorage {
  return {
    get: async () => {
      try {
        return storage().getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    },
    set: async (token) => {
      storage().setItem(TOKEN_KEY, token);
    },
    clear: async () => {
      try {
        storage().removeItem(TOKEN_KEY);
      } catch {
        // nothing to forget
      }
    },
  };
}
