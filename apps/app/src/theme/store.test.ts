import { describe, expect, it } from "vitest";

import { createThemeStore, parseThemePreference, THEME_STORAGE_KEY } from "./store.ts";

function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const writes: [string, string][] = [];
  return {
    data,
    writes,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      writes.push([key, value]);
      data.set(key, value);
    },
  };
}

describe("parseThemePreference", () => {
  it("accepts the three saved values", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to system for anything else", () => {
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("sepia")).toBe("system");
    expect(parseThemePreference("")).toBe("system");
  });
});

describe("createThemeStore", () => {
  it("starts loading and defaults to system", () => {
    const store = createThemeStore(fakeStorage());
    expect(store.getSnapshot()).toEqual({ status: "loading", preference: "system" });
  });

  it("hydrates the saved preference", async () => {
    const store = createThemeStore(fakeStorage({ [THEME_STORAGE_KEY]: "dark" }));
    await store.hydrate();
    expect(store.getSnapshot()).toEqual({ status: "ready", preference: "dark" });
  });

  it("hydrates to system when nothing is saved", async () => {
    const store = createThemeStore(fakeStorage());
    await store.hydrate();
    expect(store.getSnapshot()).toEqual({ status: "ready", preference: "system" });
  });

  it("persists and notifies on setPreference", async () => {
    const storage = fakeStorage();
    const store = createThemeStore(storage);
    await store.hydrate();

    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.setPreference("dark");

    expect(store.getSnapshot().preference).toBe("dark");
    expect(notified).toBe(1);
    expect(storage.writes).toEqual([[THEME_STORAGE_KEY, "dark"]]);

    unsubscribe();
    store.setPreference("light");
    expect(notified).toBe(1);
  });

  it("hydrates only once", async () => {
    let reads = 0;
    const storage = fakeStorage();
    const store = createThemeStore({
      getItem: async (key) => {
        reads += 1;
        return storage.getItem(key);
      },
      setItem: storage.setItem,
    });
    await Promise.all([store.hydrate(), store.hydrate()]);
    expect(reads).toBe(1);
  });
});
