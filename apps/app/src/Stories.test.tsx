import type { ApiClient } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Stories } from "./Stories.tsx";


afterEach(cleanup);

/**
 * The mobile Stories screen (issue #14) driven through the real gesture
 * stack: react-native-web runs the RN responder system in jsdom, so press /
 * slide / release are mousedown / mousemove / mouseup on the token — exactly
 * the events the Lookup Menu machine sees on Android. Geometry (menu rects,
 * viewport) is injected through the props Stories passes to StoryReader,
 * because jsdom measures everything as zero.
 */

const HOLD_MS = 30;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const SCHOOL_ENTRY = {
  entSeq: 990101,
  found: true,
  headword: "学校",
  reading: "がっこう",
  jlptLevel: "N5",
  senses: [
    { glosses: ["school"], partsOfSpeech: ["noun"] },
    { glosses: ["colloquial reading", "architectural sense"], partsOfSpeech: [] },
  ],
  kanjiForms: ["学校"],
  readings: ["がっこう"],
  pitch: { reading: "がっこう", moraCount: 4, accentPosition: 3, heiban: false, downstepAfterMora: 3 },
  srsLevel: 4,
  mastery: 0.44,
  kanji: [
    { literal: "学", known: true, srsLevel: 5, mastery: 0.56 },
    { literal: "校", known: false, srsLevel: null, mastery: null },
  ],
};

const MISE_ENTRY = {
  entSeq: 990103,
  found: true,
  headword: "店",
  reading: "みせ",
  jlptLevel: "N5",
  senses: [{ glosses: ["shop", "store"], partsOfSpeech: ["noun"] }],
  kanjiForms: ["店"],
  readings: ["みせ"],
  pitch: { reading: "みせ", moraCount: 2, accentPosition: 0, heiban: true, downstepAfterMora: null },
  srsLevel: null,
  mastery: null,
  kanji: [{ literal: "店", known: false, srsLevel: null, mastery: null }],
};

/**
 * Stateful fake of the API — same fixtures as the web Stories tests, so both
 * hosts prove the same behaviour. `requests` records method, path and body.
 */
function fakeApi(
  opts: {
    blurTranslation?: boolean;
    failReadingPut?: boolean;
    noToday?: boolean;
    /** How POST /stories/generate answers; GET /stories/generation follows it. */
    genOutcome?: "ready" | "running" | "failed";
    /** GET /stories/generation answers 404 (no run has ever happened). */
    noGeneration?: boolean;
  } = {},
) {
  const storyView = {
    id: "st-1",
    title: "がっこうの 一日",
    titleEn: "A Day at School",
    theme: "school life",
    origin: "automatic",
    genre: "diary",
    text: "がっこうでべんきょうしました。",
    createdAt: "2026-11-01T09:00:00Z",
    attempts: 1,
    sentences: [
      {
        ja: "がっこうでべんきょうしました。",
        en: "I studied at school.",
        tokens: [
          {
            surface: "がっこう",
            start: 0,
            end: 4,
            reading: "がっこう",
            dictionary: "学校",
            entSeq: 990101,
            tag: "known",
            srsLevel: 4,
            showFurigana: false,
          },
          { surface: "で", start: 4, end: 5, reading: "で", entSeq: 990102, tag: "unknown", showFurigana: false },
          { surface: "べんきょう", start: 5, end: 9, reading: "勉強", tag: "unknown", showFurigana: true },
          { surface: "しました", start: 9, end: 13, reading: "しました", tag: "unknown", showFurigana: true },
        ],
        grammarSpans: [
          {
            start: 9,
            end: 13,
            grammarPointId: "12",
            isFocus: true,
            pattern: "～てしまう",
            meaning: "completing something; unfortunately doing",
            jlptLevel: "N4",
          },
        ],
      },
      {
        ja: "みせにいきました。",
        en: "I went to the shop.",
        tokens: [
          { surface: "みせ", start: 0, end: 2, reading: "みせ", entSeq: 990103, tag: "unknown", showFurigana: false },
          { surface: "に", start: 2, end: 3, reading: "に", tag: "unknown", showFurigana: false },
          { surface: "いきました", start: 3, end: 7, reading: "いきました", tag: "unknown", showFurigana: true },
        ],
        grammarSpans: [],
      },
    ],
    questions: [
      { position: 0, promptJa: "どこで べんきょう しましたか。", optionsJa: ["がっこう", "いえ"] },
    ],
    vocabItems: [
      { entSeq: 990101, ja: "学校", en: "school", isKnown: true, isFocus: true },
      { entSeq: 990103, ja: "店", en: "shop", isKnown: false, isFocus: true },
    ],
  };
  const page = { items: [storyView], total: 1, limit: 10, offset: 0 };

  const requests: { method: string; path: string; body: unknown }[] = [];
  const settings = { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "" };
  const readingSettings = { blurTranslation: opts.blurTranslation ?? true, lookupHoldMs: HOLD_MS };

  // On-demand generation (#33/#34): the run lives "on the server"; GET hands out
  // snapshots, and "running" turns ready after two polls so the bar can move.
  let generation: Record<string, unknown> = { status: "idle", stage: null, percent: 0 };
  let genPolls = 0;

  const itemLists = [
    { id: "l1", name: "Saved", boosting: true, isDefault: true, itemCount: 1 },
    { id: "l2", name: "Travel", boosting: false, isDefault: false, itemCount: 3 },
  ];

  const fetchImpl = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url);
    const body = request.body ? await request.json() : null;
    requests.push({ method: request.method, path: pathname, body });
    if (pathname === "/stories" && request.method === "GET") return json(200, page);
    if (pathname === "/stories/today" && request.method === "GET") {
      if (opts.noToday) return json(404, { code: "no_today_story", message: "no automatic story yet" });
      return json(200, storyView);
    }
    if (pathname === "/stories/st-1" && request.method === "GET") return json(200, storyView);
    if (pathname === "/stories/st-1" && request.method === "DELETE") return new Response(null, { status: 204 });
    if (pathname === "/stories/st-1/read" && (request.method === "PUT" || request.method === "DELETE"))
      return new Response(null, { status: 204 });
    if (pathname === "/stories/st-1/rate" && request.method === "POST") return new Response(null, { status: 204 });
    if (pathname === "/stories/st-1/answers" && request.method === "POST")
      return json(200, { correct: true, practiceRecorded: true });
    if (pathname === "/stories/generation" && request.method === "GET") {
      if (opts.noGeneration) return json(404, { code: "not_found", message: "no run yet" });
      if (generation.status === "running" && ++genPolls >= 2) {
        generation = { status: "ready", stage: "saving", attempt: 1, maxAttempts: 2, percent: 100, storyId: "st-1" };
      }
      return json(200, generation);
    }
    if (pathname === "/stories/suggestions" && request.method === "GET") {
      return json(200, { genres: ["diary", "travel", "mystery"], themes: ["school life", "cooking"] });
    }
    if (pathname === "/stories/generate" && request.method === "POST") {
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
    if (pathname === "/story-settings" && request.method === "GET") return json(200, settings);
    if (pathname === "/reading-settings" && request.method === "GET") return json(200, readingSettings);
    if (pathname === "/reading-settings" && request.method === "PUT") {
      if (opts.failReadingPut) return json(500, { code: "internal", message: "server exploded" });
      Object.assign(readingSettings, body as Partial<typeof readingSettings>);
      return json(200, readingSettings);
    }
    const entry = pathname.match(/^\/dictionary\/entries\/(\d+)$/)?.[1];
    if (entry === "990101") return json(200, SCHOOL_ENTRY);
    if (entry === "990103") return json(200, MISE_ENTRY);

    if (pathname === "/item-lists" && request.method === "GET") {
      return json(200, { items: itemLists, defaultListId: "l1" });
    }
    if (pathname === "/item-lists" && request.method === "POST") {
      const name = String((body as { name?: string }).name ?? "");
      if (itemLists.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
        return json(409, { code: "duplicate_name", message: "Another list already has that name." });
      }
      const list = { id: `l${itemLists.length + 1}`, name, boosting: false, isDefault: false, itemCount: 0 };
      itemLists.push(list);
      return json(201, list);
    }
    const listMatch = pathname.match(/^\/item-lists\/([^/]+)\/items$/);
    if (listMatch && itemLists.some((l) => l.id === listMatch[1]) && request.method === "POST") {
      return new Response(null, { status: 204 });
    }
    if (pathname === "/weak-signals" && request.method === "POST") return new Response(null, { status: 204 });

    return json(404, { code: "not_found", message: "not found" });
  });
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  return { client, requests };
}

function renderStories(client: ApiClient, generationPollMs?: number) {
  return render(<Stories client={client} generationPollMs={generationPollMs} />);
}
/** Today's Story landing → "View all stories" → the Library's first row. */
async function openLibrary(client: ApiClient) {
  renderStories(client);
  fireEvent.click(await screen.findByRole("button", { name: "View all stories" }));
  return screen.findByTestId("story-row-st-1");
}
describe("Today's Story and the Story Library (mobile)", () => {
  it("opens on Today's Story and hands the Library to View all stories", async () => {
    const { client, requests } = fakeApi();
    renderStories(client);

    // Today's Story is the landing view: its button plus the day line.
    expect(await screen.findByRole("button", { name: "Read today’s story" })).toBeTruthy();
    expect(requests.some((r) => r.method === "GET" && r.path === "/stories/today")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "View all stories" }));
    const row = await screen.findByTestId("story-row-st-1");
    expect(within(row).getByText(/がっこうの 一日/)).toBeTruthy();
    expect(screen.getByText(/diary · school life · Automatic ·/)).toBeTruthy();
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    const newer = screen.getByRole("button", { name: "Newer stories" });
    const older = screen.getByRole("button", { name: "Older stories" });
    expect(newer.getAttribute("aria-disabled")).toBe("true");
    expect(older.getAttribute("aria-disabled")).toBe("true");
    expect(requests.some((r) => r.method === "GET" && r.path === "/stories")).toBe(true);
  });

  it("offers a check again when there is no Automatic Story yet", async () => {
    const { client } = fakeApi({ noToday: true });
    renderStories(client);

    expect(await screen.findByText(/No story yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(screen.getAllByText(/No story yet/).length).toBeGreaterThan(0),
    );
  });

  it("reveals and re-blurs a row's title translation without any request", async () => {
    const { client, requests } = fakeApi();
    await openLibrary(client);

    const reveal = screen.getByTestId("title-translation-st-1");
    expect(screen.getByText("Title translation hidden — tap to show")).toBeTruthy();
    fireEvent.click(reveal);
    await waitFor(() => expect(screen.queryByText("Title translation hidden — tap to show")).toBeNull());
    expect(screen.getByText("A Day at School")).toBeTruthy();
    fireEvent.click(screen.getByTestId("title-translation-st-1"));
    expect(await screen.findByText("Title translation hidden — tap to show")).toBeTruthy();
    expect(requests.some((r) => r.path === "/weak-signals")).toBe(false);
  });

  it("toggles Read from a library row, marking then unmarking", async () => {
    const { client, requests } = fakeApi();
    await openLibrary(client);

    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT" && r.path === "/stories/st-1/read")).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unmark read" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Unmark read" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1/read")).toBe(true),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Mark read" })).toBeTruthy());
  });

  it("deletes only after an in-row confirmation, and Keep cancels it", async () => {
    const { client, requests } = fakeApi();
    await openLibrary(client);

    fireEvent.click(screen.getByTestId("delete-st-1"));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Confirm delete" })).toBeNull());
    expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1")).toBe(false);

    fireEvent.click(screen.getByTestId("delete-st-1"));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1")).toBe(true));
    await waitFor(() => expect(screen.queryByTestId("story-row-st-1")).toBeNull());
  });

  it("rates a story from its library row", async () => {
    const { client, requests } = fakeApi();
    await openLibrary(client);

    fireEvent.click(screen.getByRole("button", { name: "Rate up" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path === "/stories/st-1/rate")).toBe(true));
    expect(requests.find((r) => r.path === "/stories/st-1/rate")?.body).toBe("up");
  });
});
describe("On-demand Generate (mobile)", () => {
  it("shows the Generate box with autocomplete suggestions for genre and theme", async () => {
    const api = fakeApi();
    renderStories(api.client);
    fireEvent.change(await screen.findByLabelText("Genre for this story"), { target: { value: "tra" } });
    fireEvent.click(screen.getByRole("button", { name: "travel" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(
        api.requests.find((r) => r.method === "POST" && r.path === "/stories/generate")?.body,
      ).toEqual({ genre: "travel" }),
    );
  });

  it("surprise me starts a bare run and the bar follows the server's snapshots", async () => {
    const api = fakeApi({ genOutcome: "running" });
    renderStories(api.client, 30);
    fireEvent.click(await screen.findByRole("button", { name: "Surprise me" }));
    await waitFor(() =>
      expect(
        api.requests.find((r) => r.method === "POST" && r.path === "/stories/generate")?.body,
      ).toEqual({ surprise: true }),
    );
    // The run is live: its stage line shows, and a second start is gated off.
    expect(await screen.findByText("Writing… attempt 1 of 2 40%")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Generate" }).getAttribute("aria-disabled")).toBe("true");
    // Later polls bring the finished Story: the ready line offers "Ready, read now".
    expect(await screen.findByText("A new Story is ready for you.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ready, read now" }));
    await screen.findByTestId("back-to-stories");
  });

  it("a failed run keeps the retry line on screen and leaves the form ready", async () => {
    const api = fakeApi({ genOutcome: "failed" });
    renderStories(api.client);
    fireEvent.click(await screen.findByRole("button", { name: "Generate" }));
    expect(
      await screen.findByText("Couldn’t write a Story that fits your vocabulary. Try again?"),
    ).toBeTruthy();
    // Another try is open right away: the failure cooldown never gates this button.
    expect(screen.getByRole("button", { name: "Generate" }).getAttribute("aria-disabled")).not.toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await waitFor(() =>
      expect(api.requests.filter((r) => r.method === "POST" && r.path === "/stories/generate").length).toBe(2),
    );
  });
});
