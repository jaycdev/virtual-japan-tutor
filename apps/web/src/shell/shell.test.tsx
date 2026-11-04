import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { currentLocation, renderAppAt } from "../test/renderApp.tsx";
import { activeDestination } from "./destinations.ts";

describe("activeDestination", () => {
  it.each([
    ["/", "/"],
    ["/stories", "/stories"],
    ["/stories/123", "/stories"],
    ["/grammar/n3-te", "/grammar"],
    ["/settings/appearance", "/settings"],
    ["/storiesfoo", "/"],
    ["/unknown", "/"],
  ])("lights up the right destination for %s", (pathname, expected) => {
    expect(activeDestination(pathname)).toBe(expected);
  });
});

describe("app shell", () => {
  it("puts a skip link first, then a main landmark the link targets", async () => {
    renderAppAt("/practice");
    const main = await screen.findByRole("main");
    expect(main.id).toBe("main");
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip.getAttribute("href")).toBe("#main");
  });

  it("marks only the current destination as the page, including from a nested route", async () => {
    renderAppAt("/stories/123");
    await screen.findByRole("main");

    expect(screen.getByRole("link", { name: "Stories" }).getAttribute("aria-current")).toBe("page");
    for (const label of ["Today", "Practice", "Grammar", "Settings"]) {
      expect(screen.getByRole("link", { name: label }).getAttribute("aria-current")).toBeNull();
    }
  });

  it("names the Learner and offers Log out at the foot of the sidebar", async () => {
    renderAppAt("/");
    await screen.findByRole("main");
    expect(screen.getByText("ada")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
  });

  it("sets the document title from the route", async () => {
    renderAppAt("/practice");
    await waitFor(() => expect(document.title).toBe("Practice · Virtual Japan Tutor"));
  });

  it("opens the same navigation in a sheet from the top bar, and closes it after a tap", async () => {
    const user = userEvent.setup();
    const { router } = renderAppAt("/");
    await screen.findByRole("main");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = await screen.findByRole("dialog", { name: "Navigation" });
    await user.click(within(dialog).getByRole("link", { name: "Grammar" }));

    await waitFor(() => expect(currentLocation(router)).toBe("/grammar"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("moves focus to the page and announces its title after a client-side navigation", async () => {
    const user = userEvent.setup();
    renderAppAt("/");
    const main = await screen.findByRole("main");

    // Not a navigation: the first render leaves focus where it was.
    expect(document.activeElement).not.toBe(main);
    expect(screen.getByRole("status").textContent).toBe("");

    await user.click(screen.getByRole("link", { name: "Practice" }));

    await waitFor(() => expect(document.activeElement).toBe(main));
    expect(screen.getByRole("status").textContent).toBe("Practice · Virtual Japan Tutor");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("closes the mobile sheet when the viewport grows to the sidebar breakpoint", async () => {
    const user = userEvent.setup();
    const original = window.matchMedia;
    const listeners: Array<() => void> = [];
    let wide = false;
    window.matchMedia = ((query: string) => ({
      get matches() {
        return query === "(min-width: 1024px)" && wide;
      },
      media: query,
      addEventListener: (_type: string, listener: () => void) => listeners.push(listener),
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;

    try {
      renderAppAt("/");
      await screen.findByRole("main");
      await user.click(screen.getByRole("button", { name: "Open navigation" }));
      await screen.findByRole("dialog", { name: "Navigation" });

      wide = true;
      for (const listener of listeners) listener();

      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    } finally {
      window.matchMedia = original;
    }
  });
});
