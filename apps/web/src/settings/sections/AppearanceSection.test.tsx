// The Interface Language control in Appearance (issue #125): the option labels
// name themselves (never translated), the choice re-renders the chrome in that
// language, and it is saved on the device - including the <html lang> hook.

import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";

import { renderAppAt } from "../../test/renderApp.tsx";
import { unrubyfiedKanji } from "../../test/kanjiCoverage.ts";
import { INTERFACE_LANGUAGE_STORAGE_KEY } from "../../interfacelanguage/store.ts";
import { interfaceLanguageStore } from "../../interfacelanguage/index.tsx";

describe("Appearance › Interface Language", () => {
  afterEach(() => {
    // The store is a device-wide singleton; leave every later test in English.
    interfaceLanguageStore.setLanguage("en");
    window.localStorage.clear();
    document.documentElement.lang = "en";
  });

  it("offers the three options with their untranslated labels", async () => {
    renderAppAt("/settings/appearance");
    await screen.findByText("Interface language");

    expect(screen.getByRole("button", { name: "English" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "日本語" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "日本語（ふりがな）" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("switches the chrome to Japanese, saves it, and sets <html lang>", async () => {
    renderAppAt("/settings/appearance");
    fireEvent.click(await screen.findByRole("button", { name: "日本語" }));

    // Chrome text follows the choice...
    await screen.findByText("表示言語");
    // ...but the option labels never do.
    expect(screen.getByRole("button", { name: "日本語" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "English" })).toBeTruthy();

    // ...and the device remembers it.
    await waitFor(() => expect(window.localStorage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY)).toBe("ja"));
    await waitFor(() => expect(document.documentElement.lang).toBe("ja"));
    // Plain Japanese shows no furigana.
    expect(document.querySelectorAll("rt")).toHaveLength(0);
  });

  it("furigana mode annotates the chrome and plain mode again does not", async () => {
    renderAppAt("/settings/appearance");
    fireEvent.click(await screen.findByRole("button", { name: "日本語（ふりがな）" }));
    await waitFor(() => expect(window.localStorage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY)).toBe("ja-furigana"));

    const readings = Array.from(document.querySelectorAll("rt"));
    expect(readings.length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe("ja");
    // No chrome kanji sits outside ruby. The 吾輩は猫である sample is
    // learning content (lang="ja") and the 読 mark is brand art (aria-hidden).
    expect(unrubyfiedKanji(document.body)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "日本語" }));
    await waitFor(() => expect(window.localStorage.getItem(INTERFACE_LANGUAGE_STORAGE_KEY)).toBe("ja"));
    expect(document.querySelectorAll("rt")).toHaveLength(0);
  });
});
