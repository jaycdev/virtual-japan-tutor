import { beforeEach, describe, expect, it } from "vitest";

import { appSecureStore } from "./secureStore";

// Under vitest the extensionless import resolves to the web variant
// (secureStore.ts); secureStore.native.ts is chosen by Metro on Android only.
describe("appSecureStore (web variant)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips a value under the given key", async () => {
    await appSecureStore.setItemAsync("vjt.token", "jwt-1");
    expect(await appSecureStore.getItemAsync("vjt.token")).toBe("jwt-1");
    expect(localStorage.getItem("vjt.token")).toBe("jwt-1");
  });

  it("returns null for a missing key", async () => {
    expect(await appSecureStore.getItemAsync("vjt.token")).toBeNull();
  });

  it("deletes a stored value", async () => {
    await appSecureStore.setItemAsync("vjt.serverUrl", "http://host:8080");
    await appSecureStore.deleteItemAsync("vjt.serverUrl");
    expect(await appSecureStore.getItemAsync("vjt.serverUrl")).toBeNull();
  });
});
