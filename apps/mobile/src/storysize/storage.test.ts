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
    secure.getItemAsync.mockReset();
    secure.setItemAsync.mockReset();
  });

  it("reads and writes the Android secure store", async () => {
    secure.getItemAsync.mockResolvedValue("S");
    expect(await storyTextSizeStorage.getItem(STORY_TEXT_SIZE_STORAGE_KEY)).toBe("S");
    await storyTextSizeStorage.setItem(STORY_TEXT_SIZE_STORAGE_KEY, "M");
    expect(secure.getItemAsync).toHaveBeenCalledWith(STORY_TEXT_SIZE_STORAGE_KEY);
    expect(secure.setItemAsync).toHaveBeenCalledWith(STORY_TEXT_SIZE_STORAGE_KEY, "M");
  });
});
