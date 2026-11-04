import { beforeEach, describe, expect, it, vi } from "vitest";

import * as SecureStore from "expo-secure-store";

import { appSecureStore } from "./secureStore.ts";

// The app's secure store is the Android keystore-backed expo-secure-store; the
// test host stands in for the native module (test/cjs-stubs), so the module is
// mocked here and the test asserts the delegation the app relies on.
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => "jwt-1"),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

describe("appSecureStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads a value through the native secure store", async () => {
    expect(await appSecureStore.getItemAsync("vjt.token")).toBe("jwt-1");
    expect(SecureStore.getItemAsync).toHaveBeenCalledWith("vjt.token");
  });

  it("writes a value through the native secure store", async () => {
    await appSecureStore.setItemAsync("vjt.token", "jwt-2");
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("vjt.token", "jwt-2");
  });

  it("deletes a value through the native secure store", async () => {
    await appSecureStore.deleteItemAsync("vjt.serverUrl");
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("vjt.serverUrl");
  });
});
