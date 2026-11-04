import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_STORY_TEXT_SIZE,
  STORY_TEXT_SIZE_STORAGE_KEY,
  createStoryTextSizeStore,
  parseStoryTextSize,
  type StoryTextSize,
  type StoryTextSizeStorage,
} from "./store.ts";

function memoryStorage(initial: Record<string, string> = {}): StoryTextSizeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      data[key] = value;
    },
  };
}

describe("parseStoryTextSize", () => {
  it("accepts S, M, L and XL in any case, and defaults to M", () => {
    expect(parseStoryTextSize("S")).toBe("S");
    expect(parseStoryTextSize("xl")).toBe("XL");
    expect(parseStoryTextSize(" l ")).toBe("L");
    expect(parseStoryTextSize(null)).toBe(DEFAULT_STORY_TEXT_SIZE);
    expect(parseStoryTextSize("huge")).toBe("M");
  });
});

describe("createStoryTextSizeStore", () => {
  it("hydrates the saved size and applies it", async () => {
    const applied: StoryTextSize[] = [];
    const store = createStoryTextSizeStore(memoryStorage({ [STORY_TEXT_SIZE_STORAGE_KEY]: "XL" }), (s) =>
      applied.push(s),
    );
    await store.hydrate();
    expect(store.getSnapshot().size).toBe("XL");
    expect(applied).toEqual(["XL"]);
  });

  it("keeps the default when storage cannot be read", async () => {
    const store = createStoryTextSizeStore({
      getItem: async () => {
        throw new Error("denied");
      },
      setItem: async () => {},
    });
    await store.hydrate();
    expect(store.getSnapshot().size).toBe("M");
  });

  it("applies and saves a new size, and notifies subscribers", () => {
    const storage = memoryStorage();
    const applied: StoryTextSize[] = [];
    const store = createStoryTextSizeStore(storage, (s) => applied.push(s));
    const listener = vi.fn();
    store.subscribe(listener);

    store.setSize("L");

    expect(store.getSnapshot().size).toBe("L");
    expect(applied).toEqual(["L"]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(storage.data[STORY_TEXT_SIZE_STORAGE_KEY]).toBe("L");
  });
});
