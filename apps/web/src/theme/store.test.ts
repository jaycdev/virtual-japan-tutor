import { describe, expect, it, vi } from "vitest";

import {
  THEME_STORAGE_KEY,
  createThemeStore,
  parseThemePreference,
  resolveTheme,
  type ThemePreference,
  type ThemeStorage,
} from "./store.ts";

function memoryStorage(initial: Record<string, string> = {}, { failWrites = false } = {}): ThemeStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: async (key) => data[key] ?? null,
    setItem: async (key, value) => {
      if (failWrites) throw new Error("quota");
      data[key] = value;
    },
  };
}

describe("parseThemePreference", () => {
  it("accepts the three preferences and defaults everything else to System", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("")).toBe("system");
    expect(parseThemePreference("DARK")).toBe("system");
    expect(parseThemePreference("blue")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("follows the OS only for System", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("createThemeStore", () => {
  it("starts loading on System and reads the saved preference on hydrate", async () => {
    const applied: ThemePreference[] = [];
    const store = createThemeStore(memoryStorage({ [THEME_STORAGE_KEY]: "dark" }), (p) => applied.push(p));

    expect(store.getSnapshot()).toEqual({ status: "loading", preference: "system" });
    await store.hydrate();
    expect(store.getSnapshot()).toEqual({ status: "ready", preference: "dark" });
    expect(applied).toEqual(["dark"]);
  });

  it("falls back to System when the saved value is garbage or storage fails", async () => {
    const garbage = createThemeStore(memoryStorage({ [THEME_STORAGE_KEY]: "neon" }), () => {});
    await garbage.hydrate();
    expect(garbage.getSnapshot().preference).toBe("system");

    const broken: ThemeStorage = {
      getItem: async () => {
        throw new Error("denied");
      },
      setItem: async () => {},
    };
    const applied: ThemePreference[] = [];
    const failing = createThemeStore(broken, (p) => applied.push(p));
    await failing.hydrate();
    expect(failing.getSnapshot()).toEqual({ status: "ready", preference: "system" });
    expect(applied).toEqual(["system"]);
  });

  it("only hydrates once", async () => {
    const storage = memoryStorage();
    const spy = vi.spyOn(storage, "getItem");
    const store = createThemeStore(storage, () => {});
    await Promise.all([store.hydrate(), store.hydrate()]);
    await store.hydrate();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("applies the preference before subscribers are told, then saves it", () => {
    const storage = memoryStorage();
    const order: string[] = [];
    const store = createThemeStore(storage, (p) => order.push(`apply:${p}`));
    store.subscribe(() => order.push(`notify:${store.getSnapshot().preference}`));

    store.setPreference("light");

    expect(order).toEqual(["apply:light", "notify:light"]);
    expect(store.getSnapshot().preference).toBe("light");
    expect(storage.data[THEME_STORAGE_KEY]).toBe("light");
  });

  it("keeps the choice for this visit when the write is refused", async () => {
    const store = createThemeStore(memoryStorage({}, { failWrites: true }), () => {});
    store.setPreference("dark");
    await Promise.resolve();
    expect(store.getSnapshot().preference).toBe("dark");
  });

  it("unsubscribes listeners", () => {
    const store = createThemeStore(memoryStorage(), () => {});
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    store.setPreference("dark");
    expect(listener).not.toHaveBeenCalled();
  });
});
