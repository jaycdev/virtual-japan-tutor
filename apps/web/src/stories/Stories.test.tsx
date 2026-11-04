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
    expect(screen.getByRole("link", { name: /Open today/ })).toBeTruthy();
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
    expect(screen.getByTestId("layout-grid").getAttribute("aria-pressed")).toBe("true");
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
    expect(screen.queryByTestId("story-card-a")).toBeNull();
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
    expect(screen.getByRole("link", { name: "Ready, read now" }).getAttribute("href")).toBe("/stories/n1");
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

  it("the route wires the page to the session's client", async () => {
    const api = fakeApi({ stories: libraryStories() });
    renderAppAt("/stories", { fetchOverride: api.fetch });
    expect(await screen.findByRole("heading", { name: "Story Library" })).toBeTruthy();
    expect(await screen.findByText("猫の一日")).toBeTruthy();
  });
});
