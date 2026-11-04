import { Platform } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";

import { storyTextSizeStorage } from "./storage.ts";
import { STORY_TEXT_SIZE_STORAGE_KEY } from "./store.ts";

const secure = vi.hoisted(() => ({
  getItemAsync: vi.fn<(key: string) => Promise<string | null>>(),
  setItemAsync: vi.fn<(key: string, value: string) => Promise<void>>(),
}));

vi.mock("expo-secure-store", () => ({
  getItemAsync: (key: string) => secure.getItemAsync(key),
  setItemAsync: (key: string, value: string) => secure.setItemAsync(key, value),
}));

describe("the Story text size storage is per device", () => {
  afterEach(() => {
    Platform.OS = "web";
    window.localStorage.clear();
    secure.getItemAsync.mockReset();
    secure.setItemAsync.mockReset();
  });

  it("web reads and writes localStorage", async () => {
    window.localStorage.setItem(STORY_TEXT_SIZE_STORAGE_KEY, "L");
    expect(await storyTextSizeStorage.getItem(STORY_TEXT_SIZE_STORAGE_KEY)).toBe("L");
    await storyTextSizeStorage.setItem(STORY_TEXT_SIZE_STORAGE_KEY, "XL");
    expect(window.localStorage.getItem(STORY_TEXT_SIZE_STORAGE_KEY)).toBe("XL");
    expect(secure.setItemAsync).not.toHaveBeenCalled();
  });

  it("Android reads and writes the secure store", async () => {
    Platform.OS = "android";
    secure.getItemAsync.mockResolvedValue("S");
    expect(await storyTextSizeStorage.getItem(STORY_TEXT_SIZE_STORAGE_KEY)).toBe("S");
    await storyTextSizeStorage.setItem(STORY_TEXT_SIZE_STORAGE_KEY, "M");
    expect(secure.getItemAsync).toHaveBeenCalledWith(STORY_TEXT_SIZE_STORAGE_KEY);
    expect(secure.setItemAsync).toHaveBeenCalledWith(STORY_TEXT_SIZE_STORAGE_KEY, "M");
    expect(window.localStorage.getItem(STORY_TEXT_SIZE_STORAGE_KEY)).toBeNull();
  });
});
