import type { ApiClient } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { PortalHost } from "@rn-primitives/portal";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { flushPressConfig } from "../test/press-config.ts";
import { Stories } from "./Stories.tsx";

/**
 * The rebuilt Stories page (issue #48, plan §4.5): Today's Story pinned above
 * the Story Library (a list of rows), each card's menu (a bottom sheet), the
 * delete confirmation, the Generate dialog, and the Unread/All + Genre filters.
 * The Reader itself is a separate screen now — src/reader/StoryReader.test.tsx
 * covers it.
 */

afterEach(cleanup);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Stateful fake of the Stories half of the API — same Story fixture as the
 * reader and web suites, so every host proves the same behaviour. `requests`
 * records method, path and body.
 */
function fakeApi(
  opts: {
    /** GET /stories/today answers 404 — no Automatic Story yet. */
    noToday?: boolean;
    /** GET /stories/today answers 500. */
    failToday?: boolean;
    /** The first GET /stories answers 500; Retry brings the real page. */
    failStories?: boolean;
    /** The Library page is empty. */
    noStories?: boolean;
    /** st-1 is already read (a Read check on its card). */
    readStory?: boolean;
    /** Today holds a different Story (st-0) than the Library's first card. */
    todayDiffers?: boolean;
    /** How POST /stories/generate answers; GET /stories/generation follows it. */
    genOutcome?: "ready" | "running" | "failed";
    /** PUT/DELETE /stories/:id/read answer 500. */
    failRead?: boolean;
    /** DELETE /stories/st-1 answers 500. */
    failDelete?: boolean;
    /** The server still holds a failed snapshot from a run before this visit. */
    staleFailed?: boolean;
  } = {},
) {
  const storyView = {
    id: "st-1",
    title: "がっこうの 一日",
    titleEn: "A Day at School",
    theme: "school life",
    origin: "automatic" as const,
    genre: "diary",
    text: "がっこうでべんきょうしました。",
    createdAt: "2026-11-01T09:00:00Z",
    readAt: opts.readStory ? "2026-11-02T08:00:00Z" : null,
    attempts: 1,
    sentences: [
      {
        ja: "がっこうでべんきょうしました。",
        en: "I studied at school.",
        tokens: [
          { surface: "がっこう", start: 0, end: 4, reading: "がっこう", dictionary: "学校", entSeq: 990101, tag: "known", srsLevel: 4, showFurigana: false },
          { surface: "で", start: 4, end: 5, reading: "で", entSeq: 990102, tag: "unknown", showFurigana: false },
        ],
        grammarSpans: [],
      },
    ],
    questions: [],
    vocabItems: [{ entSeq: 990101, ja: "学校", en: "school", isKnown: true, isFocus: true }],
  };
  const page1 = {
    items: [storyView, { ...storyView, id: "st-2", title: "週末の 京都", titleEn: "Weekend in Kyoto", readAt: null }],
    total: 3,
    limit: 20,
    offset: 0,
  };
  const page2 = {
    items: [{ ...storyView, id: "st-3", title: "真夜中の ラーメン", titleEn: "Late Night Ramen", readAt: null }],
    total: 3,
    limit: 20,
    offset: 2,
  };
  const emptyPage = { items: [], total: 0, limit: 20, offset: 0 };

  const requests: { method: string; path: string; body: unknown }[] = [];
  let storiesAttempts = 0;

  // On-demand generation (#33/#34): the run lives "on the server"; GET hands out
  // snapshots, and "running" turns ready after two polls so the bar can move.
  // A terminal snapshot stays on the server until the next start — including a
  // failed one from before the Learner ever opened the dialog (S2's test).
  let generation: Record<string, unknown> = opts.staleFailed
    ? {
        status: "failed",
        stage: "writing",
        attempt: 2,
        maxAttempts: 2,
        percent: 100,
        message: "Couldn’t write a Story that fits your vocabulary. Try again?",
      }
    : { status: "idle", stage: null, percent: 0 };
  let genPolls = 0;

  const fetchImpl = vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    const body = request.body ? await request.json() : null;
    requests.push({ method: request.method, path: url.pathname, body });
    if (url.pathname === "/stories" && request.method === "GET") {
      if (opts.noStories) return json(200, emptyPage);
      if (opts.failStories && ++storiesAttempts === 1)
        return json(500, { code: "internal", message: "server exploded" });
      return json(200, url.searchParams.get("offset") === "2" ? page2 : page1);
    }
    if (url.pathname === "/stories/today" && request.method === "GET") {
      if (opts.noToday) return json(404, { code: "no_today_story", message: "no automatic story yet" });
      if (opts.failToday) return json(500, { code: "internal", message: "server exploded" });
      return json(200, opts.todayDiffers ? { ...storyView, id: "st-0", title: "きのうの 一日" } : storyView);
    }
    if (url.pathname === "/stories/st-1" && request.method === "DELETE") {
      if (opts.failDelete) return json(500, { code: "internal", message: "server exploded" });
      return new Response(null, { status: 204 });
    }
    if (/^\/stories\/st-\d\/read$/.test(url.pathname) && (request.method === "PUT" || request.method === "DELETE")) {
      if (opts.failRead) return json(500, { code: "internal", message: "server exploded" });
      return new Response(null, { status: 204 });
    }
    if (url.pathname === "/stories/generation" && request.method === "GET") {
      if (generation.status === "running" && ++genPolls >= 2) {
        generation = { status: "ready", stage: "saving", attempt: 1, maxAttempts: 2, percent: 100, storyId: "st-1" };
      }
      return json(200, generation);
    }
    if (url.pathname === "/stories/suggestions" && request.method === "GET") {
      return json(200, { genres: ["diary", "travel", "mystery"], themes: ["school life", "cooking"] });
    }
    if (url.pathname === "/stories/generate" && request.method === "POST") {
      if (opts.genOutcome === "failed") {
        generation = {
          status: "failed",
          stage: "writing",
          attempt: 2,
          maxAttempts: 2,
          percent: 100,
          message: "Couldn’t write a Story that fits your vocabulary. Try again?",
        };
      } else if (opts.genOutcome === "running") {
        genPolls = 0;
        generation = { status: "running", stage: "writing", attempt: 1, maxAttempts: 2, percent: 40 };
      } else {
        generation = { status: "ready", stage: "saving", attempt: 1, maxAttempts: 1, percent: 100, storyId: "st-1" };
      }
      return json(202, generation);
    }
    return json(404, { code: "not_found", message: "not found" });
  });
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  return { client, requests };
}

function renderStories(client: ApiClient, opts: { generationPollMs?: number } = {}) {
  const onOpenStory = vi.fn();
  const utils = render(
    <>
      <PortalHost />
      <Stories client={client} onOpenStory={onOpenStory} generationPollMs={opts.generationPollMs} />
    </>,
  );
  return { ...utils, onOpenStory };
}

describe("Today's Story pinned above the Library (issue #48)", () => {
  it("pins Today's Story card over the Library list and fetches both", async () => {
    const { client, requests } = fakeApi();
    renderStories(client);

    const today = await screen.findByTestId("today-card");
    expect((await within(today).findByTestId("today-story-title")).textContent).toBe("がっこうの 一日");
    expect(within(today).getByTestId("today-story-meta").textContent).toContain("Diary · Automatic · Nov 1, 2026");
    expect(within(today).getByRole("button", { name: "Open today's story" })).toBeTruthy();

    const card = await screen.findByTestId("story-card-st-1");
    expect(within(card).getByTestId("story-meta-st-1").textContent).toContain("Diary · Automatic · Nov 1, 2026");
    expect(requests.some((r) => r.method === "GET" && r.path === "/stories/today")).toBe(true);
    expect(requests.some((r) => r.method === "GET" && r.path === "/stories")).toBe(true);
  });

  it("hands the tapped card and the Open button to the route's Reader", async () => {
    const { onOpenStory } = renderStories(fakeApi().client);

    fireEvent.click(await screen.findByTestId("today-open"));
    await waitFor(() => expect(onOpenStory).toHaveBeenCalledWith("st-1"));

    fireEvent.click(screen.getByTestId("story-open-st-2"));
    await waitFor(() => expect(onOpenStory).toHaveBeenCalledWith("st-2"));
  });

  it("skeletons the Library, and the settled cards replace them", async () => {
    renderStories(fakeApi().client);
    expect(screen.getByTestId("library-loading")).toBeTruthy();
    await screen.findByTestId("story-card-st-1");
    expect(screen.queryByTestId("library-loading")).toBeNull();
  });

  it("explains when there is no Automatic Story yet, and Check again asks again", async () => {
    const { client, requests } = fakeApi({ noToday: true });
    const today = within(await renderStories(client).findByTestId("today-card"));
    expect(await today.findByText(/No Story for today yet/)).toBeTruthy();

    fireEvent.click(today.getByTestId("today-check-again"));
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "GET" && r.path === "/stories/today").length).toBe(2),
    );
  });

  it("names a failed Today read and offers Check again", async () => {
    const { client } = fakeApi({ failToday: true });
    const today = within(await renderStories(client).findByTestId("today-card"));
    expect(await today.findByText(/Cannot load today’s Story/)).toBeTruthy();
    expect(today.getByTestId("today-check-again")).toBeTruthy();
  });

  it("offers Ready, read now for the Story a finished run just wrote, and spends it on open", async () => {
    const api = fakeApi({ todayDiffers: true, genOutcome: "ready" });
    const { onOpenStory } = renderStories(api.client);
    await screen.findByTestId("today-open");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("today-generate"));
    fireEvent.click(await screen.findByTestId("generate-confirm"));

    // The dialog that started the run steps aside once the Story is Ready —
    // the pinned card is the one that shows it (S2).
    await waitFor(() => expect(screen.queryByTestId("generate-dialog")).toBeNull());

    // The finished run's Story is not Today's (the daily one was st-0), but the
    // card offers it the moment the run reports ready.
    const ready = await screen.findByTestId("today-ready");
    fireEvent.click(ready);
    await waitFor(() => expect(onOpenStory).toHaveBeenCalledWith("st-1"));
    // Opening spends the offer: the card's own Open is the same Story now.
    await waitFor(() => expect(screen.queryByTestId("today-ready")).toBeNull());
  });

  it("a spent ready offer does not come back on a fresh mount with the same snapshot", async () => {
    const api = fakeApi({ todayDiffers: true, genOutcome: "ready" });
    const first = renderStories(api.client);
    await first.findByTestId("today-open");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("today-generate"));
    fireEvent.click(await screen.findByTestId("generate-confirm"));
    const ready = await screen.findByTestId("today-ready");
    fireEvent.click(ready);
    await waitFor(() => expect(first.onOpenStory).toHaveBeenCalledWith("st-1"));

    // The server keeps the ready snapshot until the next start, but the offer
    // was opened: a remount that saw the same stale snapshot starts a clean page
    // (S3 — the old tautology left the button on screen forever).
    first.unmount();
    renderStories(api.client);
    await screen.findByTestId("today-open");
    expect(screen.queryByTestId("today-ready")).toBeNull();
  });
});

describe("The Library list, pager and states", () => {
  it("lists the Library as rows", async () => {
    const view = renderStories(fakeApi().client);
    await view.findByTestId("library-list");
    expect(view.queryByTestId("library-grid")).toBeNull();
  });

  it("pages the Library with Newer/Older over the server's pages", async () => {
    const { client } = fakeApi();
    renderStories(client);

    expect((await screen.findByTestId("library-page-summary")).textContent).toBe("1–2 of 3");
    expect(screen.getByTestId("pager-newer").getAttribute("aria-disabled")).toBe("true");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("pager-older"));
    await screen.findByTestId("story-card-st-3");
    expect(screen.getByTestId("library-page-summary").textContent).toBe("3–3 of 3");
    expect(screen.getByTestId("pager-older").getAttribute("aria-disabled")).toBe("true");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("pager-newer"));
    await screen.findByTestId("story-card-st-1");
  });

  it("fails the Library with one Retry that brings the page", async () => {
    const { client } = fakeApi({ failStories: true });
    renderStories(client);

    expect(await screen.findByText(/Cannot load your library/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByTestId("story-card-st-1");
    expect(screen.queryByText(/Cannot load your library/)).toBeNull();
  });

  it("an empty Library points at Generate, which opens the dialog", async () => {
    const { client } = fakeApi({ noStories: true });
    renderStories(client);

    expect(await screen.findByText(/No Stories yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Generate a Story" }));
    await screen.findByTestId("generate-dialog");
  });

  it("reveals and re-hides one card's translation; the English is absent until then", async () => {
    const { client, requests } = fakeApi();
    renderStories(client);
    const cardEl = await screen.findByTestId("story-card-st-1");
    const HIDDEN = "Title translation hidden — tap to show";

    // Hidden means hidden: the English string is not in the tree at all — a
    // transparent/blur trick would still let Android render and announce it.
    expect(within(cardEl).getByText(HIDDEN)).toBeTruthy();
    expect(within(cardEl).queryByText("A Day at School")).toBeNull();

    fireEvent.click(screen.getByTestId("title-translation-st-1"));
    await waitFor(() => {
      expect(within(cardEl).queryByText(HIDDEN)).toBeNull();
      expect(within(cardEl).getByText("A Day at School")).toBeTruthy();
    });

    // Per card: revealing one never reveals its neighbours.
    const card2 = await screen.findByTestId("story-card-st-2");
    expect(within(card2).getByText(HIDDEN)).toBeTruthy();
    expect(within(card2).queryByText("Weekend in Kyoto")).toBeNull();

    fireEvent.click(screen.getByTestId("title-translation-st-1"));
    expect(await within(cardEl).findByText(HIDDEN)).toBeTruthy();
    expect(within(cardEl).queryByText("A Day at School")).toBeNull();
    expect(requests.some((r) => r.path === "/weak-signals")).toBe(false);
  });
});

describe("Card menus (bottom sheet)", () => {
  it("puts the rows in a bottom sheet, and reports a failed mark", async () => {
    const { client, requests } = fakeApi({ failRead: true });
    renderStories(client);
    await screen.findByTestId("story-card-st-1");

    fireEvent.click(screen.getByTestId("story-menu-st-1"));
    const sheet = await screen.findByTestId("story-menu-sheet");
    fireEvent.click(within(sheet).getByTestId("menu-mark-read"));

    await waitFor(() => expect(requests.some((r) => r.method === "PUT" && r.path === "/stories/st-1/read")).toBe(true));
    expect(await screen.findByTestId("library-action-error")).toBeTruthy();
    // The sheet's row closed the sheet; the error is the page's line, not a toast.
    expect(screen.queryByTestId("story-menu-sheet")).toBeNull();
  });

  it("asks before deleting; Keep cancels, Delete deletes and the card leaves", async () => {
    const { client, requests } = fakeApi();
    renderStories(client);
    await screen.findByTestId("story-card-st-1");

    fireEvent.click(screen.getByTestId("story-menu-st-1"));
    const sheet = await screen.findByTestId("story-menu-sheet");
    fireEvent.click(within(sheet).getByTestId("menu-delete"));

    const confirm = await screen.findByTestId("confirm-delete");
    expect(confirm.textContent).toContain("がっこうの 一日");
    fireEvent.click(screen.getByTestId("confirm-delete-keep"));
    await waitFor(() => expect(screen.queryByTestId("confirm-delete")).toBeNull());
    expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1")).toBe(false);

    fireEvent.click(screen.getByTestId("story-menu-st-1"));
    fireEvent.click(await screen.findByTestId("menu-delete"));
    fireEvent.click(await screen.findByTestId("confirm-delete-accept"));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1")).toBe(true));
    await waitFor(() => {
      expect(screen.queryByTestId("story-card-st-1")).toBeNull();
      expect(screen.queryByTestId("confirm-delete")).toBeNull();
    });
    // The rest of the page is untouched.
    expect(screen.getByTestId("story-card-st-2")).toBeTruthy();
  });

  it("a failed delete keeps the confirm open and says why, once", async () => {
    const { client } = fakeApi({ failDelete: true });
    renderStories(client);
    await screen.findByTestId("story-card-st-1");

    fireEvent.click(screen.getByTestId("story-menu-st-1"));
    const sheet = await screen.findByTestId("story-menu-sheet");
    fireEvent.click(within(sheet).getByTestId("menu-delete"));
    fireEvent.click(await screen.findByTestId("confirm-delete-accept"));

    // The dialog stays open with the server's words inside it — once, not also
    // on the page behind it (S10).
    const dialog = await screen.findByTestId("confirm-delete");
    expect(await within(dialog).findByTestId("confirm-delete-error")).toBeTruthy();
    expect(within(dialog).getByTestId("confirm-delete-error").textContent).toContain("server exploded");
    expect(screen.queryByTestId("library-action-error")).toBeNull();
    expect(screen.getByTestId("story-card-st-1")).toBeTruthy();

    // Keep afterwards hands the one remaining copy to the page's own line.
    fireEvent.click(within(dialog).getByTestId("confirm-delete-keep"));
    await waitFor(() => expect(screen.queryByTestId("confirm-delete")).toBeNull());
    expect(await screen.findByTestId("library-action-error")).toBeTruthy();
  });
});

describe("Filters: Unread/All and Genre", () => {
  it("Unread hides the read card and counts what it hid; All brings it back", async () => {
    const { client } = fakeApi({ readStory: true });
    renderStories(client);
    await screen.findByTestId("story-card-st-1");

    fireEvent.click(screen.getByTestId("filter-unread"));
    await waitFor(() => expect(screen.queryByTestId("story-card-st-1")).toBeNull());
    expect(screen.getByTestId("story-card-st-2")).toBeTruthy();
    expect(screen.getByTestId("library-filter-note").textContent).toContain(
      "1 of the 2 Stories on this page are hidden by your filters.",
    );

    fireEvent.click(screen.getByTestId("filter-all"));
    await screen.findByTestId("story-card-st-1");
    expect(screen.queryByTestId("library-filter-note")).toBeNull();
  });

  it("a Genre with no match says so and Clear filters restores the page", async () => {
    const { client } = fakeApi();
    renderStories(client);
    await screen.findByTestId("story-card-st-1");

    fireEvent.pointerDown(screen.getByTestId("genre-filter"), { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(screen.getByTestId("genre-filter"), { button: 0, pointerType: "mouse" });
    const content = await screen.findByTestId("genre-filter-content");
    fireEvent.click(within(content).getByTestId("genre-filter-option-travel"));

    expect((await screen.findByTestId("library-empty")).textContent).toContain("No Stories match these filters.");
    expect(screen.getByTestId("library-filter-note")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByTestId("story-card-st-1");
    expect(screen.queryByTestId("library-empty")).toBeNull();
    expect(screen.queryByTestId("library-filter-note")).toBeNull();
  });

  it("Unread and Genre combine: both filters apply at once", async () => {
    const { client } = fakeApi({ readStory: true });
    renderStories(client);
    await screen.findByTestId("story-card-st-2");

    // st-1 is read; the Unread chip hides it.
    fireEvent.click(screen.getByTestId("filter-unread"));
    await waitFor(() => expect(screen.queryByTestId("story-card-st-1")).toBeNull());

    // st-2 is a diary; Travel on top of Unread leaves nothing on the page.
    fireEvent.pointerDown(screen.getByTestId("genre-filter"), { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(screen.getByTestId("genre-filter"), { button: 0, pointerType: "mouse" });
    const content = await screen.findByTestId("genre-filter-content");
    fireEvent.click(within(content).getByTestId("genre-filter-option-travel"));

    expect((await screen.findByTestId("library-empty")).textContent).toContain("No Stories match these filters.");
    expect(screen.getByTestId("library-filter-note").textContent).toContain("2 of the 2");

    // Both chips/labels still read as selected, and one Clear undoes both.
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByTestId("story-card-st-1");
    expect(screen.queryByTestId("library-empty")).toBeNull();
  });
});

describe("On-demand Generate dialog", () => {
  it("sends the chosen Genre and Theme with the request", async () => {
    const api = fakeApi();
    renderStories(api.client);
    await screen.findByTestId("today-card");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("today-generate"));
    const dialog = await screen.findByTestId("generate-dialog");

    fireEvent.pointerDown(within(dialog).getByTestId("generate-genre-picker"), { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(within(dialog).getByTestId("generate-genre-picker"), { button: 0, pointerType: "mouse" });
    const genres = await screen.findByTestId("generate-genre-picker-content");
    fireEvent.click(within(genres).getByTestId("generate-genre-picker-option-travel"));

    fireEvent.pointerDown(within(dialog).getByTestId("generate-theme-picker"), { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(within(dialog).getByTestId("generate-theme-picker"), { button: 0, pointerType: "mouse" });
    const themes = await screen.findByTestId("generate-theme-picker-content");
    fireEvent.click(within(themes).getByTestId("generate-theme-picker-option-cooking"));

    fireEvent.click(within(dialog).getByTestId("generate-confirm"));
    await waitFor(() =>
      expect(
        api.requests.find((r) => r.method === "POST" && r.path === "/stories/generate")?.body,
      ).toEqual({ genre: "travel", theme: "cooking" }),
    );
  });

  it("a bare run starts with an empty body, the bar follows the snapshots, and finishing refreshes the page", async () => {
    const api = fakeApi({ genOutcome: "running" });
    // Poll slowly enough that the running snapshot is still on screen when the
    // test looks for it — 30 ms flips to ready between assertion ticks under
    // the full-suite CPU load (flake seen in turbo runs).
    renderStories(api.client, { generationPollMs: 250 });
    await screen.findByTestId("today-card");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("today-generate"));
    fireEvent.click(await screen.findByTestId("generate-confirm"));
    await waitFor(() =>
      expect(
        api.requests.find((r) => r.method === "POST" && r.path === "/stories/generate")?.body,
      ).toEqual({}),
    );

    // Live: the pinned card and the dialog both show the run, and starting a
    // second one is gated off while this one writes.
    const progress = await screen.findByTestId("generation-progress");
    expect(progress.textContent).toContain("Writing… attempt 1 of 2 40%");
    expect(screen.getByTestId("today-generate").getAttribute("aria-disabled")).toBe("true");

    // Closing the dialog never disturbs the run — the card keeps the bar.
    fireEvent.click(screen.getByTestId("generate-cancel"));
    await waitFor(() => expect(screen.queryByTestId("generate-dialog")).toBeNull());
    expect(screen.getByTestId("generation-progress")).toBeTruthy();

    // The run finishes on its polls; both halves of the page refetch.
    await waitFor(() =>
      expect(requestsCount(api, "/stories/today")).toBeGreaterThanOrEqual(2),
    );
    expect(requestsCount(api, "/stories")).toBeGreaterThanOrEqual(2);
  });

  it("a failed run leaves the server's words on the pinned card", async () => {
    const api = fakeApi({ genOutcome: "failed", noToday: true });
    renderStories(api.client);
    await screen.findByTestId("today-card");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("today-generate"));
    fireEvent.click(await screen.findByTestId("generate-confirm"));

    const today = await screen.findByTestId("today-card");
    expect(
      await within(today).findByText(/Couldn’t write a Story that fits your vocabulary/),
    ).toBeTruthy();
    expect(within(today).getByTestId("today-retry")).toBeTruthy();
  });

  it("a stale failed snapshot never speaks in a dialog that has started nothing", async () => {
    renderStories(fakeApi({ staleFailed: true }).client);
    await screen.findByTestId("today-card");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("today-generate"));
    const dialog = await screen.findByTestId("generate-dialog");
    expect(within(dialog).queryByTestId("generate-error")).toBeNull();
    expect(dialog.textContent).not.toContain("Couldn’t write a Story");
    // And a fresh run can still be started from here.
    expect(within(dialog).getByTestId("generate-confirm").getAttribute("aria-disabled")).toBeNull();
  });

  it("a failed run started here keeps the dialog open, says it once, and can be retried", async () => {
    const api = fakeApi({ genOutcome: "failed", noToday: true });
    renderStories(api.client);
    await screen.findByTestId("today-card");

    await flushPressConfig();
    fireEvent.click(screen.getByTestId("today-generate"));
    fireEvent.click(await screen.findByTestId("generate-confirm"));

    const dialog = await screen.findByTestId("generate-dialog");
    expect(await within(dialog).findByTestId("generate-error")).toBeTruthy();
    // Once — the words live in the dialog, not also behind it.
    expect(screen.queryByTestId("library-action-error")).toBeNull();
    expect((dialog.textContent.match(/Couldn’t write a Story/g) ?? []).length).toBe(1);

    // Re-enabled: a second tap really starts a second run (the old dead button
    // quietly blocked retries).
    fireEvent.click(within(dialog).getByTestId("generate-confirm"));
    await waitFor(() =>
      expect(
        api.requests.filter((r) => r.method === "POST" && r.path === "/stories/generate").length,
      ).toBe(2),
    );
  });
});

function requestsCount(api: { requests: { method: string; path: string }[] }, path: string) {
  return api.requests.filter((r) => r.method === "GET" && r.path === path).length;
}
