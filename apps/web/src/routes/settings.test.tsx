import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { STORY_TEXT_SIZE_STORAGE_KEY } from "../storysize/store.ts";
import { THEME_STORAGE_KEY } from "../theme/store.ts";
import { currentLocation, renderAppAt } from "../test/renderApp.tsx";
import { fakeSettingsApi, freshState } from "../test/fakeSettingsApi.ts";
import { stubViewport } from "../test/viewport.ts";

afterEach(() => stubViewport(false));

describe("Settings layout", () => {
  it("sends /settings to Appearance on a wide screen (two panes)", async () => {
    stubViewport(true);
    const { router } = renderAppAt("/settings");
    await waitFor(() => expect(currentLocation(router)).toBe("/settings/appearance"));
    expect(await screen.findByRole("heading", { name: "Appearance" })).toBeTruthy();
  });

  it("keeps /settings as the hub list on a narrow screen", async () => {
    stubViewport(false);
    const { router } = renderAppAt("/settings");
    expect(await screen.findByRole("heading", { name: "Settings" })).toBeTruthy();
    expect(currentLocation(router)).toBe("/settings");
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).getByRole("link", { name: /Item Lists/ }).getAttribute("href")).toBe("/settings/lists");
  });

  it("lists every section and marks the open one as the current page", async () => {
    renderAppAt("/settings/reading");
    const nav = await screen.findByRole("navigation", { name: "Settings sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/settings/appearance",
      "/settings/reading",
      "/settings/stories",
      "/settings/lists",
      "/settings/level",
      "/settings/marumori",
      "/settings/ai",
      "/settings/server",
    ]);
    expect(within(nav).getByRole("link", { name: /Reading/ }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("link", { name: /Appearance/ }).getAttribute("aria-current")).toBeNull();
  });

  it("opens Item Lists at /settings/lists, the link Practice uses", async () => {
    renderAppAt("/settings/lists");
    expect(await screen.findByRole("heading", { name: "Item Lists" })).toBeTruthy();
  });

  it("says so for a section that does not exist, and offers the way back", async () => {
    const { router } = renderAppAt("/settings/nope");
    expect(await screen.findByText("That settings section doesn’t exist.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("link", { name: "Back to Settings" }));
    await waitFor(() => expect(currentLocation(router)).toBe("/settings"));
  });

  it("opens the deep links other pages send the Learner to", async () => {
    // FocusGlance's "See all" sends /settings/focus; the Practice summary sends
    // /settings/lists; the Settings hub's MaruMori card sends /settings/marumori.
    renderAppAt("/settings/focus", { api: fakeSettingsApi(freshState()) });
    expect(await screen.findByRole("heading", { name: "Today’s Focus Set" })).toBeTruthy();

    renderAppAt("/settings/marumori", { api: fakeSettingsApi(freshState()) });
    expect(await screen.findByRole("heading", { name: "MaruMori" })).toBeTruthy();
  });

  it("focuses the section heading when the rail switches sections, and Tab reaches the content", async () => {
    // The rail sits inside <main>; focusing <main> after a switch would put the
    // next Tab back at the top of the rail. The page marks its heading instead.
    stubViewport(true);
    const user = userEvent.setup();
    renderAppAt("/settings/appearance", { api: fakeSettingsApi(freshState()) });
    await screen.findByRole("heading", { name: "Appearance" });

    const listsLink = within(screen.getByRole("navigation", { name: "Settings sections" }))
      .getByRole("link", { name: /Item Lists/ });
    listsLink.focus();
    await user.keyboard("{Enter}");

    const heading = await screen.findByRole("heading", { name: "Item Lists" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /Saved/ }));
  });
});

describe("Settings › Appearance", () => {
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
