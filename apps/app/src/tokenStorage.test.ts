import { describe, expect, it } from "vitest";
import { secureStoreTokenStorage, type SecureStoreLike } from "./tokenStorage.ts";

/** Stands in for expo-secure-store. Like the real one, it rejects keys with illegal characters. */
function fakeSecureStore(failWith?: Error) {
  const data = new Map<string, string>();
  const check = (key: string) => {
    if (!/^[\w.-]+$/.test(key)) throw new Error(`Invalid key: ${key}`);
    if (failWith) throw failWith;
  };
  const store: SecureStoreLike = {
    getItemAsync: async (key) => {
      check(key);
      return data.get(key) ?? null;
    },
    setItemAsync: async (key, value) => {
      check(key);
      data.set(key, value);
    },
    deleteItemAsync: async (key) => {
      check(key);
      data.delete(key);
    },
  };
  return { store, data };
}

describe("secureStoreTokenStorage", () => {
  it("stores the token in the secure store under a key it accepts", async () => {
    const { store, data } = fakeSecureStore();
    const s = secureStoreTokenStorage(store);
    expect(await s.get()).toBeNull();
    await s.set("tok-1");
    expect(await s.get()).toBe("tok-1");
    expect([...data.values()]).toEqual(["tok-1"]);
  });

  it("clear removes the token", async () => {
    const { store } = fakeSecureStore();
    const s = secureStoreTokenStorage(store);
    await s.set("tok-1");
    await s.clear();
    expect(await s.get()).toBeNull();
  });

  it("reads as signed out, rather than throwing, when the keystore is unavailable", async () => {
    const { store } = fakeSecureStore(new Error("keystore locked"));
    const s = secureStoreTokenStorage(store);
    expect(await s.get()).toBeNull();
    await expect(s.clear()).resolves.toBeUndefined();
  });

  it("surfaces a failed write so a login that cannot be remembered is not silently lost", async () => {
    const { store } = fakeSecureStore(new Error("keystore locked"));
    await expect(secureStoreTokenStorage(store).set("tok-1")).rejects.toThrow("keystore locked");
  });
});
