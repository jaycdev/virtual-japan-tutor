import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { themeBootstrapScript } from "./bootstrap.ts";
import { THEME_STORAGE_KEY } from "./store.ts";

// The inline script is the real code that runs in index.html before the bundle.
// These tests evaluate that exact string against the jsdom document, with a
// controllable prefers-color-scheme.

type Listener = (event: { matches: boolean }) => void;

let prefersDark = false;
let listeners: Listener[] = [];

function stubMatchMedia() {
  listeners = [];
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === "(prefers-color-scheme: dark)" ? prefersDark : false;
    },
    media: query,
    addEventListener: (_type: string, listener: Listener) => listeners.push(listener),
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
}

/** What a page would have when index.html's script runs. */
function runBootstrap() {
  // The script is ours (built by bootstrap.ts), so evaluating it is the point.
  new Function(themeBootstrapScript())();
}

const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  prefersDark = false;
  stubMatchMedia();
});

afterEach(() => {
  document.documentElement.className = "";
});

describe("no-flash theme script", () => {
  it.each([
    ["light", false, false],
    ["light", true, false],
    ["dark", false, true],
    ["dark", true, true],
    ["system", false, false],
    ["system", true, true],
  ])("saved %s with prefers-dark=%s gives dark=%s before anything else runs", (saved, osDark, expected) => {
    window.localStorage.setItem(THEME_STORAGE_KEY, saved);
    prefersDark = osDark;
    runBootstrap();
    expect(isDark()).toBe(expected);
  });

  it("treats no saved value, and an unknown one, as System", () => {
    prefersDark = true;
    runBootstrap();
    expect(isDark()).toBe(true);

    document.documentElement.className = "";
    window.localStorage.setItem(THEME_STORAGE_KEY, "neon");
    prefersDark = false;
    runBootstrap();
    expect(isDark()).toBe(false);
  });

  it("follows a live change of the OS setting while the preference is System", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    runBootstrap();
    expect(isDark()).toBe(false);

    // A MediaQueryList updates `matches` before it dispatches `change`.
    prefersDark = true;
    for (const listener of listeners) listener({ matches: true });
    expect(isDark()).toBe(true);
  });

  it("ignores a live OS change when the Learner picked Light or Dark", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    runBootstrap();
    prefersDark = true;
    for (const listener of listeners) listener({ matches: true });
    expect(isDark()).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    const original = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    try {
      prefersDark = true;
      expect(() => runBootstrap()).not.toThrow();
      expect(isDark()).toBe(true);
    } finally {
      // Put the page's storage back exactly as it was.
      if (original) Object.defineProperty(window, "localStorage", original);
      else delete (window as unknown as { localStorage?: Storage }).localStorage;
    }
  });
});
