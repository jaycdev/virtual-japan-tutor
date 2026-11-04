import { describe, expect, it } from "vitest";

import { TOKEN_KEY, localTokenStorage } from "./tokenStorage.ts";

describe("localTokenStorage", () => {
  it("round-trips the token through the given storage", async () => {
    const storage = window.localStorage;
    const tokens = localTokenStorage(() => storage);

    expect(await tokens.get()).toBeNull();
    await tokens.set("tok-1");
    expect(storage.getItem(TOKEN_KEY)).toBe("tok-1");
    expect(await tokens.get()).toBe("tok-1");
    await tokens.clear();
    expect(await tokens.get()).toBeNull();
  });

  it("lets a failed write surface, so login does not pretend to remember", async () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    await expect(localTokenStorage(() => full).set("tok")).rejects.toThrow("quota");
  });

  it("reads as signed out, and clears quietly, when storage is unavailable", async () => {
    const denied = () => {
      throw new DOMException("denied", "SecurityError");
    };
    const tokens = localTokenStorage(denied);
    expect(await tokens.get()).toBeNull();
    await expect(tokens.clear()).resolves.toBeUndefined();
  });
});
