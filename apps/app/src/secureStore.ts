import type { SecureStoreLike } from "./tokenStorage.ts";

// expo-secure-store has no web backend — its native module is an empty object
// on web, so every call rejects and login can never persist a session there.
// Web keeps the same keys in localStorage instead (the same platform split as
// src/theme/storage.ts). Metro picks secureStore.native.ts for Android, so
// importers must keep the specifier extensionless ("./src/secureStore", never
// "./src/secureStore.ts").
//
// Deliberate security tradeoff (#44, reviewed): on web the session JWT — key
// `vjt.token`, the same key the legacy web client used in
// apps/web/src/tokenStorage.ts — and the server URL sit in localStorage in
// plaintext, readable by any script on this origin. That is acceptable for
// the self-hosted single-origin deployment this app targets: anyone who can
// run script on the origin already owns the session. Closing the hole means
// moving the token to an httpOnly cookie, which is API-side work (Set-Cookie,
// CORS credentials, CSRF handling) — left as a possible follow-up rather than
// half-done on the client.
//
// Safari private mode (and storage-blocked frames) do not remove localStorage;
// they make using it throw. The old `?.` chain turned that into a silent
// no-op: login "succeeded" but nothing persisted, and the session was gone on
// reload. Instead, storage that fails its probe falls back to an explicit
// in-memory map — the session survives the page load and the store never
// pretends a write to disk happened.

type LocalWebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Writes land here when the host blocks storage (private mode). */
const inMemoryStore = new Map<string, string>();

/** localStorage when every operation works; undefined when the host blocks it. */
function webStorage(): LocalWebStorage | undefined {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return undefined;
    // Private mode lets getItem through but throws on setItem, so the probe
    // has to write.
    ls.setItem("vjt.storageProbe", "1");
    ls.removeItem("vjt.storageProbe");
    return ls;
  } catch {
    return undefined;
  }
}

/** localStorage-backed stand-in for the native secure store (web only). */
export const appSecureStore: SecureStoreLike = {
  getItemAsync: async (key) => {
    const ls = webStorage();
    if (ls) return ls.getItem(key);
    return inMemoryStore.get(key) ?? null;
  },
  setItemAsync: async (key, value) => {
    const ls = webStorage();
    if (ls) ls.setItem(key, value);
    else inMemoryStore.set(key, value);
  },
  deleteItemAsync: async (key) => {
    inMemoryStore.delete(key);
    const ls = webStorage();
    if (ls) ls.removeItem(key);
  },
};
