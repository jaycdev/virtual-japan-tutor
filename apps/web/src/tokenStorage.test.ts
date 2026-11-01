import { beforeEach, describe, expect, it } from "vitest";
import { localStorageTokenStorage } from "./tokenStorage.ts";

beforeEach(() => localStorage.clear());

describe("localStorageTokenStorage", () => {
  it("round-trips a token under the vjt.token key", async () => {
    const s = localStorageTokenStorage();
    expect(await s.get()).toBeNull();
    await s.set("abc");
    expect(await s.get()).toBe("abc");
    expect(localStorage.getItem("vjt.token")).toBe("abc");
  });

  it("clear forgets the token", async () => {
    const s = localStorageTokenStorage();
    await s.set("abc");
    await s.clear();
    expect(await s.get()).toBeNull();
    expect(localStorage.getItem("vjt.token")).toBeNull();
  });

  it("treats an unavailable localStorage as signed out instead of throwing", async () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    const s = localStorageTokenStorage("k", broken);
    expect(await s.get()).toBeNull();
    await expect(s.clear()).resolves.toBeUndefined();
  });
});
