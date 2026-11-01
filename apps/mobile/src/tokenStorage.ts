import type { TokenStorage } from "@vjt/core";

/** The slice of `expo-secure-store` we use; injectable so the adapter is testable without native code. */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const KEY = "vjt.token";

/**
 * Session token in the Android Keystore-backed secure store. If the keystore cannot be read
 * the user is simply signed out; a failed write is surfaced so login does not silently
 * succeed without being remembered.
 */
export function secureStoreTokenStorage(store: SecureStoreLike, key = KEY): TokenStorage {
  return {
    get: async () => {
      try {
        return await store.getItemAsync(key);
      } catch {
        return null;
      }
    },
    set: (token) => store.setItemAsync(key, token),
    clear: async () => {
      try {
        await store.deleteItemAsync(key);
      } catch {
        // nothing to forget
      }
    },
  };
}
