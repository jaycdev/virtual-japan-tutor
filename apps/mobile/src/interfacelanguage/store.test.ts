// The Interface Language store (issue #125): what the device remembers, and how
// a bad memory is treated. The factory takes storage, so these tests fake it;
// src/interfacelanguage/storage.ts wires it to the Android secure store.
// Mirrors apps/web/src/interfacelanguage/store.test.ts.

import { describe, expect, it } from "vitest";
import { createInterfaceLanguageStore, INTERFACE_LANGUAGE_STORAGE_KEY, parseInterfaceLanguage } from "./store.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  return {
    storage: {
      async getItem(key: string) {
        return data.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        data.set(key, value);
        writes.push([key, value]);
      },
    },
    data,
    writes,
  };
}

describe("the Interface Language store", () => {
  it("starts in English, whatever storage will turn out to hold", () => {
    const store = createInterfaceLanguageStore(fakeStorage().storage);
    expect(store.getSnapshot().language).toBe("en");
  });

  it("reads the saved choice on hydrate and applies it", () => {
    const applied: string[] = [];
    const store = createInterfaceLanguageStore(
      fakeStorage({ [INTERFACE_LANGUAGE_STORAGE_KEY]: "ja-furigana" }).storage,
      (language) => applied.push(language),
    );
    return store.hydrate().then(() => {
      expect(store.getSnapshot().language).toBe("ja-furigana");
      expect(applied).toEqual(["ja-furigana"]);
    });
  });

  it("saves the new choice under the device key, applies it, and notifies at once", async () => {
    const fake = fakeStorage();
    const applied: string[] = [];
    const store = createInterfaceLanguageStore(fake.storage, (language) => applied.push(language));
    let notified = 0;
    store.subscribe(() => (notified += 1));

    store.setLanguage("ja");

    expect(store.getSnapshot().language).toBe("ja");
    expect(applied).toEqual(["ja"]);
    expect(notified).toBe(1);
    await Promise.resolve();
    expect(fake.writes).toEqual([[INTERFACE_LANGUAGE_STORAGE_KEY, "ja"]]);
  });

  it("falls back to English for a stored value that is not a language", async () => {
    const store = createInterfaceLanguageStore(
      fakeStorage({ [INTERFACE_LANGUAGE_STORAGE_KEY]: "klingon" }).storage,
    );
    await store.hydrate();
    expect(store.getSnapshot().language).toBe("en");
  });

  it("parses every real value and nothing else", () => {
    expect(parseInterfaceLanguage("ja")).toBe("ja");
    expect(parseInterfaceLanguage("ja-furigana")).toBe("ja-furigana");
    expect(parseInterfaceLanguage("en")).toBe("en");
    expect(parseInterfaceLanguage(null)).toBe("en");
    expect(parseInterfaceLanguage("de")).toBe("en");
  });
});
