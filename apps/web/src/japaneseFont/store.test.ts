import { describe, expect, it } from "vitest";

import {
  createJapaneseFontStore,
  DEFAULT_JAPANESE_FONT,
  JAPANESE_FONT_STORAGE_KEY,
  parseJapaneseFont,
  type JapaneseFont,
  type JapaneseFontStorage,
} from "./store.ts";

function memoryStorage(initial: Record<string, string> = {}): JapaneseFontStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => data[key] ?? null,
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

  it("defaults to serif", () => {
    expect(DEFAULT_JAPANESE_FONT).toBe("serif");
  });
});

describe("createJapaneseFontStore", () => {
  it("starts on serif and applies the saved choice on hydrate", async () => {
    const applied: JapaneseFont[] = [];
    const store = createJapaneseFontStore(memoryStorage({ [JAPANESE_FONT_STORAGE_KEY]: "sans" }), (f) =>
      applied.push(f),
    );
    expect(store.getSnapshot().font).toBe("serif");
    await store.hydrate();
    expect(store.getSnapshot().font).toBe("sans");
    expect(applied).toEqual(["sans"]);
  });

  it("falls back to serif when storage fails to read", async () => {
    const store = createJapaneseFontStore({
      getItem: () => Promise.reject(new Error("refused")),
      setItem: async () => {},
    });
    await store.hydrate();
    expect(store.getSnapshot().font).toBe("serif");
  });

  it("applies and saves a new choice, and notifies subscribers", () => {
    const storage = memoryStorage();
    const applied: JapaneseFont[] = [];
    const store = createJapaneseFontStore(storage, (f) => applied.push(f));
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);

    store.setFont("sans");

    expect(store.getSnapshot().font).toBe("sans");
    expect(applied).toEqual(["sans"]);
    expect(calls).toBe(1);
    expect(storage.data[JAPANESE_FONT_STORAGE_KEY]).toBe("sans");
    unsubscribe();
  });
});
