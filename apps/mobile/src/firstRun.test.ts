import { beforeEach, describe, expect, it, vi } from "vitest";

// The rule itself is tested in packages/core; this covers the adapter: the
// flag lives in the Android secure store under the same key as before
// (vjt.setupSeen), so existing installs keep their "seen" state.
const secure = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
  },
}));

import { hasSetupSeen, markSetupSeen } from "./firstRun.ts";

describe("first-run adapter", () => {
  beforeEach(() => {
    secure.clear();
  });

  it("reads an install that already saw setup under the existing key", async () => {
    secure.set("vjt.setupSeen", "yes");
    expect(await hasSetupSeen()).toBe(true);
  });

  it("treats a fresh device as not seen", async () => {
    expect(await hasSetupSeen()).toBe(false);
  });

  it("marks the flag under vjt.setupSeen so a later launch sees it", async () => {
    await markSetupSeen();
    expect(secure.get("vjt.setupSeen")).toBe("yes");
    expect(await hasSetupSeen()).toBe(true);
  });
});
