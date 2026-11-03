import type { SecureStoreLike } from "./tokenStorage.ts";

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
const KEY = "vjt.serverUrl";

export interface ServerUrlStorage {
  get(): Promise<string | null>;
  set(url: string): Promise<void>;
}

/**
 * The Learner's in-app server URL (issue #13): remembered across launches next to
 * the session token. Not a secret, but the secure store is already the dependency
 * that hydration waits on, and a second storage module (AsyncStorage) would only add
 * surface. A read failure simply falls back to the build-time default.
 */
export function secureStoreServerUrl(store: SecureStoreLike, key = KEY): ServerUrlStorage {
  return {
    get: async () => {
      try {
        return await store.getItemAsync(key);
      } catch {
        return null;
      }
    },
    set: (url) => store.setItemAsync(key, url),
  };
}
