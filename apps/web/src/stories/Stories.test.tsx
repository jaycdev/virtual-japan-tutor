// The web Stories page (plan 4.5, issue #79) against the stateful fake API.
// The behaviours ported from the mobile suite: the pinned Today's Story, the
// Unread/Genre filters riding the URL, the remembered layout, Mark Read and
// Delete from the card menu, the Generate dialog's full run, and the pager.
import { createMemoryRouter, RouterProvider } from "react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { fakeApi, makeStory } from "@/test/fakeApi";
import type { FakeApi } from "@/test/fakeApi";
import { currentLocation, renderAppAt } from "@/test/renderApp";
import { STORIES_LAYOUT_STORAGE_KEY, Stories } from "./Stories.tsx";

function renderStories(api: FakeApi, path = "/stories") {
  const router = createMemoryRouter([{ path: "/stories", element: <Stories client={api.client} generationPollMs={10} /> }], {
    initialEntries: [path],
  });
  return { router, ...render(<RouterProvider router={router} />) };
}

function libraryStories() {
  return [
    makeStory("a", { title: "猫の一日", genre: "daily_life", readAt: "2026-11-03T10:00:00Z" }),
    makeStory("b", { title: "駅で", genre: "travel" }),
  ];
}

describe("Stories page", () => {
  it("pins Today's Story above the Story Library", async () => {
    const api = fakeApi({
      today: makeStory("t1", { title: "今日の話" }),
      stories: libraryStories(),
    });
    renderStories(api);
    expect(await screen.findByRole("heading", { name: "Stories" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: /Today.s Story/ })).toBeTruthy();
    expect(await screen.findByRole("link", { name: /Open today/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Story Library" })).toBeTruthy();
    expect(await screen.findByText("猫の一日")).toBeTruthy();
    expect(screen.getByText("駅で")).toBeTruthy();
  });

  it("filters Unread and All through the URL, so Back and reload keep the view", async () => {
    const api = fakeApi({ stories: libraryStories() });
    const { router } = renderStories(api, "/stories?filter=unread");
    // The read Story is hidden; the unread one stands.
    expect(await screen.findByText("駅で")).toBeTruthy();
    expect(screen.queryByText("猫の一日")).toBeNull();
    expect(currentLocation(router)).toBe("/stories?filter=unread");

    await userEvent.click(screen.getByRole("button", { name: "All" }));
    await waitFor(() => expect(currentLocation(router)).toBe("/stories"));
    expect(await screen.findByText("猫の一日")).toBeTruthy();
  });

  it("carries the Genre filter in the URL and explains what it hides", async () => {
    const api = fakeApi({ stories: libraryStories() });
    const { router } = renderStories(api, "/stories");
    await screen.findByText("駅で"); // wait for the Library to settle before touching the select
    await userEvent.selectOptions(screen.getByTestId("genre-filter"), "daily_life");
    await waitFor(() => expect(currentLocation(router)).toBe("/stories?genre=daily_life"));
    expect(screen.getByText("猫の一日")).toBeTruthy();
    expect(screen.queryByText("駅で")).toBeNull();
    expect((await screen.findByTestId("library-filter-note")).textContent).toBe(
      "1 of the 2 Stories on this page are hidden by your filters.",
    );
  });

  it("remembers the grid/list choice on this device", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    expect((await screen.findByTestId("layout-grid")).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByTestId("layout-list"));
    expect(window.localStorage.getItem(STORIES_LAYOUT_STORAGE_KEY)).toBe("list");
    expect(screen.getByTestId("layout-list").getAttribute("aria-pressed")).toBe("true");
  });

  it("reveals the title translation on request, and only then", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    const toggle = await screen.findByTestId("title-translation-a");
    expect(toggle.textContent).toContain("translation hidden");
    await userEvent.click(toggle);
    expect((await screen.findByTestId("title-translation-a")).textContent).toContain("Story a");
  });

  it("marks a Library story read from the card menu, and the Read mark lands", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    await userEvent.click(await screen.findByTestId("story-menu-b"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mark read" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PUT" && c.path === "/stories/b/read")).toBe(true));
    expect(await screen.findByTestId("story-read-b")).toBeTruthy();
  });

  it("asks before deleting, then drops the Story from the page", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    await userEvent.click(await screen.findByTestId("story-menu-a"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/猫の一日/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/stories/a")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("story-card-a")).toBeNull());
  });

  it("keeps the Story when the delete is refused", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    await userEvent.click(await screen.findByTestId("story-menu-a"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog");
    // A delete that fails leaves both the Story and the open confirmation.
    api.rejectDeletes = true;
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/stories/a")).toBe(true));
    expect(await within(dialog).findByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("story-card-a")).toBeTruthy();
    expect(within(dialog).getByText(/猫の一日/)).toBeTruthy();
  });

  it("opens the Generate dialog and closes it again without starting a run", async () => {
    const api = fakeApi({ today: makeStory("t1"), stories: [] });
    renderStories(api);
    await userEvent.click(await screen.findByTestId("today-generate"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.some((c) => c.method === "POST" && c.path === "/stories/generate")).toBe(false);
  });

  it("runs Generate end to end: choices travel to the request, and Ready steps the dialog aside", async () => {
    const api = fakeApi({ today: makeStory("t1", { title: "今日の話" }), stories: libraryStories() });
    renderStories(api);
    await userEvent.click(await screen.findByTestId("today-generate"));
    const dialog = await screen.findByRole("dialog");
    // The Genre/Theme choices come from the server's suggestions; wait for them.
    await screen.findByRole("option", { name: "Travel" });
    await userEvent.selectOptions(within(dialog).getByTestId("generate-genre-picker"), "travel");
    await screen.findByRole("option", { name: "food" });
    await userEvent.selectOptions(within(dialog).getByTestId("generate-theme-picker"), "food");
    await userEvent.click(within(dialog).getByTestId("generate-confirm"));

    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/stories/generate")).toBe(true));
    const request = api.calls.find((c) => c.path === "/stories/generate")?.body as { genre?: string; theme?: string };
    expect(request.genre).toBe("travel");
    expect(request.theme).toBe("food");

    // The run speaks its progress inside the dialog while it goes.
    expect(await screen.findByTestId("generate-progress")).toBeTruthy();

    // It finishes: the dialog steps aside, the card offers the new Story, and
    // the Library refetches and shows it without a reload.
    api.pushStory(makeStory("n1", { title: "新しい話", origin: "on_demand" }));
    api.setGeneration({ status: "ready", percent: 100, storyId: "n1" });
    await waitFor(() => expect(screen.queryByTestId("generate-confirm")).toBeNull());
    // findBy: the card's re-read lands a beat after the dialog steps aside.
    expect((await screen.findByRole("link", { name: "Ready, read now" })).getAttribute("href")).toBe("/stories/n1");
    expect(await screen.findByTestId("story-card-n1")).toBeTruthy();
  });

  it("pages the Library and keeps the pager honest", async () => {
    const api = fakeApi({
      stories: [makeStory("p1"), makeStory("p2"), makeStory("p3")],
      pageSize: 2,
    });
    renderStories(api);
    expect((await screen.findByTestId("library-page-summary")).textContent).toBe("1-2 of 3");
    await userEvent.click(screen.getByTestId("pager-older"));
    await waitFor(() =>
      expect(api.calls.some((c) => c.method === "GET" && c.path === "/stories" && c.search.includes("offset=2"))).toBe(true),
    );
    expect((await screen.findByTestId("library-page-summary")).textContent).toBe("3-3 of 3");
    expect(screen.getByTestId("pager-older").hasAttribute("disabled")).toBe(true);
  });

  it("stacks filters: Unread and Genre apply together, not one over the other", async () => {
    const api = fakeApi({ stories: libraryStories() });
    const { router } = renderStories(api, "/stories");
    await screen.findByText("駅で"); // the Library settled; the controls are live
    await userEvent.click(screen.getByRole("button", { name: "Unread" }));
    await waitFor(() => expect(currentLocation(router)).toBe("/stories?filter=unread"));
    // Second filter, fired after the first: it must join the URL, not replace
    // it (the old code composed from window.location, which the router never
    // writes — under a memory router it is always empty).
    await userEvent.selectOptions(screen.getByTestId("genre-filter"), "daily_life");
    await waitFor(() => expect(currentLocation(router)).toBe("/stories?filter=unread&genre=daily_life"));
    // The only daily_life Story is the read one, so the pair leaves nothing:
    // a replaced (not stacked) filter would still show 猫の一日 here.
    expect(await screen.findByText("No Stories match these filters.")).toBeTruthy();
    expect(screen.queryByText("猫の一日")).toBeNull();
  });

  it("lines the Library up in rows when the Learner asks for rows", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    await screen.findByText("猫の一日");
    await userEvent.click(screen.getByTestId("layout-list"));
    expect(screen.getByTestId("library-list").className).toContain("flex-col");
  });

  it("reads this device's layout choice back on load", async () => {
    window.localStorage.setItem(STORIES_LAYOUT_STORAGE_KEY, "list");
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    expect((await screen.findByTestId("library-list")).className).toContain("flex-col");
    expect(screen.getByTestId("layout-list").getAttribute("aria-pressed")).toBe("true");
    window.localStorage.removeItem(STORIES_LAYOUT_STORAGE_KEY);
  });

  it("fails the Library with one Retry that brings the page back", async () => {
    const api = fakeApi({ stories: libraryStories(), failStories: true });
    renderStories(api);
    expect(await screen.findByText("library read failed")).toBeTruthy();
    api.failStories = false;
    await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
    expect(await screen.findByText("猫の一日")).toBeTruthy();
    expect(screen.queryByText("library read failed")).toBeNull();
  });

  it("a Genre with no match says so, and Clear filters brings the page back", async () => {
    const api = fakeApi({ stories: libraryStories() });
    const { router } = renderStories(api, "/stories?genre=ghost");
    expect(await screen.findByText("No Stories match these filters.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(currentLocation(router)).toBe("/stories"));
    expect(await screen.findByText("猫の一日")).toBeTruthy();
  });

  it("marks a Story unread from the card menu, and the Read mark goes away", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    await userEvent.click(await screen.findByTestId("story-menu-a"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Mark unread" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "DELETE" && c.path === "/stories/a/read")).toBe(true));
    expect(await screen.findByTestId("story-card-a")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("story-read-a")).toBeNull());
  });

  it("a failed run started here keeps the dialog open, says so, and can be tried again", async () => {
    const api = fakeApi({ today: null, stories: [] });
    renderStories(api);
    await userEvent.click(await screen.findByTestId("today-generate"));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByTestId("generate-confirm"));
    await waitFor(() => expect(api.calls.some((c) => c.method === "POST" && c.path === "/stories/generate")).toBe(true));
    // The run the Learner started here fails: the failure speaks inside the
    // dialog, which stays open, and Generate stands ready for another try.
    api.setGeneration({ status: "failed", percent: 20, message: "the writer fell asleep" });
    expect((await within(dialog).findByTestId("generate-error")).textContent).toBe("the writer fell asleep");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(within(dialog).getByTestId("generate-confirm").hasAttribute("disabled")).toBe(false);

    await userEvent.click(within(dialog).getByTestId("generate-confirm"));
    await waitFor(() =>
      expect(api.calls.filter((c) => c.method === "POST" && c.path === "/stories/generate").length).toBe(2),
    );
  });

  it("the stretched link and the card's own controls all stand in the tab order", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    const openLink = await screen.findByTestId("story-open-a");
    // Tab from the top of the page until the stretched link holds focus.
    let guard = 0;
    while (document.activeElement !== openLink && guard < 25) {
      await user.tab();
      guard += 1;
    }
    expect(document.activeElement).toBe(openLink);
    // The raised controls follow it in the same card — the overlay never
    // swallows them out of the keyboard's reach.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("story-menu-a"));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId("title-translation-a"));
  });

  it("opens the card menu with the keyboard alone", async () => {
    const user = userEvent.setup();
    const api = fakeApi({ stories: libraryStories() });
    renderStories(api);
    const trigger = await screen.findByTestId("story-menu-b");
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitem", { name: "Mark read" })).toBeTruthy();
  });

  it("the route wires the page to the session's client", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderAppAt("/stories", { fetchOverride: api.fetch });
    expect(await screen.findByRole("heading", { name: "Story Library" })).toBeTruthy();
    expect(await screen.findByText("猫の一日")).toBeTruthy();
  });
});
