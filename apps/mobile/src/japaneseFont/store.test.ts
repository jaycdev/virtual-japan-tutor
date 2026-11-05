import { describe, expect, it } from "vitest";

import {
  createJapaneseFontStore,
  DEFAULT_JAPANESE_FONT,
  JAPANESE_FONT_STORAGE_KEY,
  parseJapaneseFont,
  type JapaneseFontStorage,
} from "./store.ts";

function memoryStorage(initial: Record<string, string> = {}): JapaneseFontStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => (key in data ? data[key] : null),
    setItem: async (key, value) => {
      data[key] = value;
    },
  };
}

describe("parseJapaneseFont", () => {
  it("accepts sans in any case and falls back to serif for anything else", () => {
    expect(parseJapaneseFont("sans")).toBe("sans");
    expect(parseJapaneseFont(" SANS ")).toBe("sans");
    expect(parseJapaneseFont("serif")).toBe("serif");
    expect(parseJapaneseFont(null)).toBe(DEFAULT_JAPANESE_FONT);
    expect(parseJapaneseFont("comic")).toBe("serif");
  });
});

describe("createJapaneseFontStore", () => {
  it("starts on serif and reads the saved choice on hydrate", async () => {
    const store = createJapaneseFontStore(memoryStorage({ [JAPANESE_FONT_STORAGE_KEY]: "sans" }));
    expect(store.getSnapshot().font).toBe("serif");
    await store.hydrate();
    expect(store.getSnapshot().font).toBe("sans");
  });

  it("falls back to serif when storage fails to read", async () => {
    const store = createJapaneseFontStore({
      getItem: () => Promise.reject(new Error("refused")),
      setItem: async () => {},
    });
    await store.hydrate();
    expect(store.getSnapshot().font).toBe("serif");
  });

  it("updates, saves and notifies subscribers on setFont", async () => {
    const storage = memoryStorage();
    const store = createJapaneseFontStore(storage);
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);

    store.setFont("sans");
    await Promise.resolve();

    expect(store.getSnapshot().font).toBe("sans");
    expect(calls).toBe(1);
    expect(storage.data[JAPANESE_FONT_STORAGE_KEY]).toBe("sans");
    unsubscribe();
  });
});
