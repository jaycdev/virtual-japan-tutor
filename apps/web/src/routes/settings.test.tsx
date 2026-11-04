import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { STORY_TEXT_SIZE_STORAGE_KEY } from "../storysize/store.ts";
import { THEME_STORAGE_KEY } from "../theme/store.ts";
import { currentLocation, renderAppAt } from "../test/renderApp.tsx";

describe("Settings › Appearance", () => {
  it("opens Appearance from /settings", async () => {
    const { router } = renderAppAt("/settings");
    await waitFor(() => expect(currentLocation(router)).toBe("/settings/appearance"));
    expect(await screen.findByRole("heading", { name: "Appearance" })).toBeTruthy();
  });

  it("switches the theme at once, saves it on this device, and marks the choice", async () => {
    const user = userEvent.setup();
    renderAppAt("/settings/appearance");
    await user.click(await screen.findByRole("button", { name: "Dark" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe("true");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("sets the Story text size as a data attribute the reader's CSS variables read", async () => {
    const user = userEvent.setup();
    renderAppAt("/settings/appearance");
    await user.click(await screen.findByRole("button", { name: "XL" }));

    expect(document.documentElement.dataset.storyTextSize).toBe("XL");
    expect(window.localStorage.getItem(STORY_TEXT_SIZE_STORAGE_KEY)).toBe("XL");
  });
});
