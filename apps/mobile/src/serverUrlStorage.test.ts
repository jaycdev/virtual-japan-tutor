import { describe, expect, it } from "vitest";
import { secureStoreServerUrl } from "./serverUrlStorage.ts";
import type { SecureStoreLike } from "./tokenStorage.ts";

function fakeStore(initial: Record<string, string> = {}): SecureStoreLike {
  const data = new Map(Object.entries(initial));
  return {
    async getItemAsync(key) {
      return data.get(key) ?? null;
    },
    async setItemAsync(key, value) {
      data.set(key, value);
    },
    async deleteItemAsync(key) {
      data.delete(key);
    },
  };
}

describe("secureStoreServerUrl", () => {
  it("returns null when nothing is stored, so the build-time default applies", async () => {
    const storage = secureStoreServerUrl(fakeStore());
    await expect(storage.get()).resolves.toBeNull();
  });

  it("round-trips a saved url", async () => {
    const storage = secureStoreServerUrl(fakeStore());
    await storage.set("http://192.168.1.50:8080");
    await expect(storage.get()).resolves.toBe("http://192.168.1.50:8080");
  });

  it("treats a secure-store read failure as unset", async () => {
    const storage = secureStoreServerUrl({
      async getItemAsync() {
        throw new Error("keystore unavailable");
      },
      async setItemAsync() {},
      async deleteItemAsync() {},
    });
    await expect(storage.get()).resolves.toBeNull();
  });
});
