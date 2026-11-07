// Switching the Interface Language on the phone (issue #125): the compact switch
// on the login card and the one on Appearance both go through the device store,
// so a tap re-speaks the chrome on the spot (no reload, no refetch) and writes
// the choice to the secure store. These tests drive the real InterfaceLanguageGate
// over a faked secure store. Each test re-imports a fresh module graph so the
// singleton store never carries a choice into the next test.

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// The per-device secure store, swapped for an in-memory map (as in the theme and
// Appearance tests) so a choice can be seeded and read back.
const secure = vi.hoisted(() => new Map<string, string>());
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
  },
}));

const pressed = (name: string) =>
  (screen.getByRole("button", { name }) as HTMLElement).getAttribute("aria-pressed");

async function freshLogin() {
  vi.resetModules();
  const { Login } = await import("../Login.tsx");
  const { InterfaceLanguageGate } = await import("./index.tsx");
  return { Login, InterfaceLanguageGate };
}

async function freshAppearance() {
  vi.resetModules();
  const { AppearanceSettings } = await import("../AppearanceSettings.tsx");
  const { InterfaceLanguageGate } = await import("./index.tsx");
  const { ThemeProvider } = await import("../theme/index.tsx");
  const { StoryTextSizeProvider } = await import("../storysize/index.tsx");
  return { AppearanceSettings, InterfaceLanguageGate, ThemeProvider, StoryTextSizeProvider };
}

// The first import pays the cold transform cost; take it in a hook so a slow
// first test doesn't time out and leak into the next.
beforeAll(async () => {
  await freshLogin();
  await freshAppearance();
}, 60_000);

beforeEach(() => {
  secure.clear();
});

describe("the login card's Interface Language switch", () => {
  it("re-speaks the card the moment a language is picked, and saves it", async () => {
    const { Login, InterfaceLanguageGate } = await freshLogin();
    render(
      <InterfaceLanguageGate>
        <Login
          busy={false}
          error={undefined}
          serverUrl="http://lan:8080"
          onLogin={vi.fn()}
          onSaveServerUrl={vi.fn(async () => {})}
        />
      </InterfaceLanguageGate>,
    );

    // English first, then the pick.
    expect(pressed("English")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));

    // The Log in button is now the Japanese entry, on the same screen.
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
    expect(pressed("日本語")).toBe("true");
    await waitFor(() => expect(secure.get("vjt.interfaceLanguage")).toBe("ja"));
  });

  it("opens in the language the device already saved", async () => {
    secure.set("vjt.interfaceLanguage", "ja-furigana");
    const { Login, InterfaceLanguageGate } = await freshLogin();
    render(
      <InterfaceLanguageGate>
        <Login
          busy={false}
          error={undefined}
          serverUrl="http://lan:8080"
          onLogin={vi.fn()}
          onSaveServerUrl={vi.fn(async () => {})}
        />
      </InterfaceLanguageGate>,
    );

    await waitFor(() => expect(pressed("日本語（ふりがな）")).toBe("true"));
    // The card's own button already reads Japanese; a screen reader hears the
    // plain word, readings left out.
    expect(screen.getByRole("button", { name: "ログイン" })).toBeTruthy();
  });
});

describe("the Appearance Interface Language switch", () => {
  it("switches the whole app the moment a chip is tapped, and remembers it", async () => {
    const { AppearanceSettings, InterfaceLanguageGate, ThemeProvider, StoryTextSizeProvider } =
      await freshAppearance();
    render(
      <InterfaceLanguageGate>
        <ThemeProvider>
          <StoryTextSizeProvider>
            <AppearanceSettings />
          </StoryTextSizeProvider>
        </ThemeProvider>
      </InterfaceLanguageGate>,
    );

    // The pickers appear once the per-device stores have hydrated (as in the
    // existing Appearance tests); the language chips come with them.
    await waitFor(() => expect(screen.getByRole("button", { name: "日本語" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "日本語" }));

    // The legend under the theme/font pickers speaks Japanese now — one line,
    // because plain Japanese draws no furigana columns.
    expect(screen.getByText("表示言語")).toBeTruthy();
    expect(pressed("日本語")).toBe("true");
    await waitFor(() => expect(secure.get("vjt.interfaceLanguage")).toBe("ja"));
  });

  it("starts from the language the device already saved", async () => {
    secure.set("vjt.interfaceLanguage", "ja");
    const { AppearanceSettings, InterfaceLanguageGate, ThemeProvider, StoryTextSizeProvider } =
      await freshAppearance();
    render(
      <InterfaceLanguageGate>
        <ThemeProvider>
          <StoryTextSizeProvider>
            <AppearanceSettings />
          </StoryTextSizeProvider>
        </ThemeProvider>
      </InterfaceLanguageGate>,
    );

    await waitFor(() => expect(pressed("日本語")).toBe("true"));
    await waitFor(() => expect(screen.getByText("表示言語")).toBeTruthy());
  });
});
