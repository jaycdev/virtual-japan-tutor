import type { SecureStoreLike } from "./tokenStorage.ts";

// expo-secure-store has no web backend — its native module is an empty object
// on web, so every call rejects and login can never persist a session there.
// Web keeps the same keys in localStorage instead (the same platform split as
// src/theme/storage.ts). Metro picks secureStore.native.ts for Android, so
// importers must keep the specifier extensionless ("./src/secureStore", never
// "./src/secureStore.ts").

/** localStorage-backed stand-in for the native secure store (web only). */
export const appSecureStore: SecureStoreLike = {
  getItemAsync: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  setItemAsync: async (key, value) => {
    globalThis.localStorage?.setItem(key, value);
  },
  deleteItemAsync: async (key) => {
    globalThis.localStorage?.removeItem(key);
  },
};
