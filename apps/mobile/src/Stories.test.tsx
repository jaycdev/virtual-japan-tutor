import type { ApiClient } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StyleSheet } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeBackHandler, type FakeBackHandler } from "../test/back-handler-fake.ts";
import { setBackHandlerForTests } from "./hardwareBack.ts";
import { reduceHold, type Rect } from "./reader/holdMenu.ts";
import { Stories } from "./Stories.tsx";

// Pass the module through untouched except for wrapping reduceHold in a spy:
// one test then proves the SHIPPED reader runs the pure machine (issue #14
// review, major 2), while every other test behaves exactly as before.
vi.mock("./reader/holdMenu.ts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./reader/holdMenu.ts")>();
  return { ...mod, reduceHold: vi.fn(mod.reduceHold) };
});

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
const SCREEN = { width: 400, height: 800 };

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

/**
 * Menu geometry the release hit-test reads: press point (300, 300), option
 * rows stacked below it. (300, 337) sits over Dictionary, (300, 387) Grammar,
 * (300, 437) Save, (300, 487) Save to…; (5, 5) is over nothing.
 */
const RECTS: Record<string, Rect> = {
  "token-menu": { x: 220, y: 312, width: 160, height: 200 },
  "menu-option-dictionary": { x: 220, y: 312, width: 160, height: 50 },
  "menu-option-grammar": { x: 220, y: 362, width: 160, height: 50 },
  "menu-option-save": { x: 220, y: 412, width: 160, height: 50 },
  "menu-option-saveTo": { x: 220, y: 462, width: 160, height: 50 },
};

function renderStories(client: ApiClient, generationPollMs?: number) {
  return render(
    <Stories
      client={client}
      measure={(testID) => RECTS[testID] ?? null}
      screenSize={SCREEN}
      generationPollMs={generationPollMs}
    />,
  );
}

/** Today's Story landing → open story → the reader's fetches (reading settings, lists) settled. */
async function openStory(client: ApiClient) {
  renderStories(client);
  fireEvent.click(await screen.findByRole("button", { name: "Read today’s story" }));
  await screen.findByTestId("back-to-stories");
  // The reader fetches reading settings + Item Lists on mount; give their
  // mocked responses time to land before any gesture reads them.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

/** Today's Story landing → "View all stories" → the Library's first row. */
async function openLibrary(client: ApiClient) {
  renderStories(client);
  fireEvent.click(await screen.findByRole("button", { name: "View all stories" }));
  return screen.findByTestId("story-row-st-1");
}

const token = (sentence: number, index: number) => screen.getByTestId(`token-${sentence}-${index}`);

/**
 * React-fiber helper: the generated DOM carries only resolved CSS, so to see
 * a component's *style prop* (the RN-side declaration, before the host's
 * cascade) tests walk the fiber from a rendered element. RN attaches the
 * fiber to each host element under a `__reactFiber$…` key.
 */
type Fiber = { memoizedProps: Record<string, unknown> | null; return: Fiber | null };

function fiberFrom(el: Element): Fiber | null {
  const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  return key ? ((el as unknown as Record<string, Fiber>)[key] ?? null) : null;
}

/** The flattened style prop of the nearest component at/above `el` that has one. */
function styleOfTokenSurface(testID: string): Record<string, unknown> {
  const el = screen.getByTestId(testID);
  for (const node of [el, ...Array.from(el.querySelectorAll("*"))]) {
    let f = fiberFrom(node);
    while (f) {
      const p = f.memoizedProps;
      if (p && typeof p.style === "object" && p.style !== null) {
        const flat = (StyleSheet.flatten(p.style as object) ?? {}) as Record<string, unknown>;
        if ("textDecorationLine" in flat) return flat;
      }
      f = f.return;
    }
  }
  return {};
}

/** Finger down at (x, y) and held past the Lookup threshold. */
async function pressAndHold(sentence: number, index: number, x = 300, y = 300) {
  fireEvent.mouseDown(token(sentence, index), { clientX: x, clientY: y });
  await act(async () => {
    await new Promise((r) => setTimeout(r, HOLD_MS + 30));
  });
}

/** Slide to (x, y) and lift there — the release point picks the option. */
function releaseAt(sentence: number, index: number, x: number, y: number) {
  fireEvent.mouseMove(token(sentence, index), { clientX: x, clientY: y });
  fireEvent.mouseUp(token(sentence, index), { clientX: x, clientY: y });
}

const weakSignals = (requests: { path: string; body: unknown }[]) =>
  requests.filter((r) => r.path === "/weak-signals").flatMap((r) => (r.body as { signals: unknown[] }).signals);

let back: FakeBackHandler;

beforeEach(() => {
  back = fakeBackHandler();
  setBackHandlerForTests(back);
});

afterEach(() => {
  setBackHandlerForTests(undefined);
});

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

  it("the reader header shows the title, reveals its translation, and toggles Read", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    expect(screen.getByText("がっこうの 一日")).toBeTruthy();
    expect(screen.getByText(/diary · Automatic ·/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("reader-title-translation"));
    await waitFor(() => expect(screen.queryByText("Title translation hidden — tap to show")).toBeNull());
    expect(screen.getByText("A Day at School")).toBeTruthy();
    expect(requests.some((r) => r.path === "/weak-signals")).toBe(false);

    fireEvent.click(screen.getByTestId("reader-read-toggle"));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT" && r.path === "/stories/st-1/read")).toBe(true));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unmark read" })).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Unmark read" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1/read")).toBe(true),
    );
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

describe("Story reader gestures (mobile)", () => {
  it("a quick tap selects the sentence, primes the Lookup row, and hands the panel back to sentence-mode", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);
    const panel = await screen.findByLabelText("Reading Panel");

    fireEvent.mouseDown(token(0, 0), { clientX: 300, clientY: 300 });
    // While the finger is down the panel is in word-mode: the word's Lookup
    // details replace the sentence in the same fixed box, and the entry fetch
    // is already primed.
    expect(within(panel).getByText("Word meaning")).toBeTruthy();
    expect(within(panel).queryByLabelText("Sentence Translation")).toBeNull();
    // Release synchronously: HOLD_MS is tiny, so awaiting anything between press
    // and release lets a slow runner cross the threshold and turn the tap into a
    // hold (flaky on CI). The fetch assertion therefore comes after the release.
    fireEvent.mouseUp(token(0, 0), { clientX: 300, clientY: 300 });
    await waitFor(() => expect(requests.some((r) => r.path === "/dictionary/entries/990101")).toBe(true));

    // Released before the threshold: no menu, no Weak Signal — and the panel
    // is back to sentence-mode, not showing the stale word.
    expect(screen.queryByLabelText("Lookup menu")).toBeNull();
    expect(await within(panel).findByLabelText("Sentence Translation")).toBeTruthy();
    expect(within(panel).queryByText("Word meaning")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOLD_MS + 40));
    });
    expect(requests.some((r) => r.path === "/weak-signals")).toBe(false);
  });

  it("a hold opens the Lookup menu at the finger and reports one Weak Signal per word", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    await pressAndHold(0, 0);
    const menu = screen.getByLabelText("Lookup menu");
    expect(within(menu).getByTestId("menu-option-dictionary").textContent).toContain("Dictionary");
    expect(within(menu).getByTestId("menu-option-save").textContent).toContain("Save");
    expect(within(menu).getByTestId("menu-option-saveTo").textContent).toContain("Save to…");
    // がっこう sits in no Grammar Span, so there is no Grammar row.
    expect(within(menu).queryByTestId("menu-option-grammar")).toBeNull();

    await waitFor(() => expect(requests.some((r) => r.path === "/weak-signals")).toBe(true));
    expect(weakSignals(requests)).toEqual([{ itemKind: "vocabulary", itemRef: "990101", reason: "lookup" }]);

    // Holding the same word again must not signal it a second time.
    releaseAt(0, 0, 5, 5); // lift outside: the menu just closes
    await pressAndHold(0, 0);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(weakSignals(requests).filter((s) => (s as { reason: string }).reason === "lookup").length).toBe(1);
  });

  it("lifting outside every option just closes the menu", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    await pressAndHold(0, 0);
    releaseAt(0, 0, 5, 5);
    await waitFor(() => expect(screen.queryByLabelText("Lookup menu")).toBeNull());
    expect(screen.queryByTestId("dictionary-window")).toBeNull();
    expect(requests.some((r) => r.method === "POST" && r.path.startsWith("/item-lists/"))).toBe(false);
  });

  it("slide-release on Save writes to the Default List and notes it in the header", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    await pressAndHold(0, 0);
    releaseAt(0, 0, 300, 437); // over the Save row

    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l1/items")).toBe(true));
    expect(requests.find((r) => r.path === "/item-lists/l1/items")?.body).toEqual({
      itemKind: "vocabulary",
      itemRef: "990101",
    });
    expect((await screen.findByTestId("save-note")).textContent).toBe("Saved to Saved.");
  });

  it("Save to… opens the sheet over the finger's word; another list saves into it", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    await pressAndHold(0, 0);
    releaseAt(0, 0, 300, 487); // over the Save to… row

    const sheet = await screen.findByTestId("save-list-l1");
    expect(within(sheet).getByText("default")).toBeTruthy();
    fireEvent.click(screen.getByTestId("save-list-l2"));

    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l2/items")).toBe(true));
    expect(requests.find((r) => r.path === "/item-lists/l2/items")?.body).toEqual({
      itemKind: "vocabulary",
      itemRef: "990101",
    });
    expect(await screen.findByTestId("save-note")).toBeTruthy();
    expect(await screen.findByText("Saved to Travel.")).toBeTruthy();
    // A successful save dismisses the sheet.
    await waitFor(() => expect(screen.queryByTestId("save-list-l1")).toBeNull());
  });

  it("the sheet creates a new list and only then saves into it", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    await pressAndHold(0, 0);
    releaseAt(0, 0, 300, 487);
    await screen.findByTestId("create-list");

    fireEvent.change(screen.getByPlaceholderText("New list name"), { target: { value: "Food" } });
    fireEvent.click(screen.getByTestId("create-list"));

    await waitFor(() =>
      expect(
        requests.some((r) => r.method === "POST" && r.path === "/item-lists" && (r.body as { name?: string }).name === "Food"),
      ).toBe(true),
    );
    // The item goes to the created list's own id — l3, the create's answer.
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l3/items")).toBe(true));
    expect(await screen.findByText("Saved to Food.")).toBeTruthy();
  });

  it("a Grammar Span token signals the span, and release on Grammar opens the span window without any fetch", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    await pressAndHold(0, 3); // しました — inside ～てしまう, no dictionary link
    const menu = screen.getByLabelText("Lookup menu");
    // しました itself has no entry, so Dictionary is dimmed…
    expect(menu.querySelector('[data-testid="menu-option-dictionary"][aria-disabled="true"]')).toBeTruthy();
    // …while Grammar is live.
    releaseAt(0, 3, 300, 387); // over the Grammar row

    const win = await screen.findByTestId("grammar-window");
    expect(within(win).getByText("～てしまう")).toBeTruthy();
    expect(within(win).getByText("completing something; unfortunately doing")).toBeTruthy();
    // The span data rides the Story payload: no grammar-point request, and
    // an unlinked token primes no dictionary fetch either.
    expect(requests.some((r) => r.path.startsWith("/grammar/points/"))).toBe(false);
    expect(requests.some((r) => r.path === "/dictionary/entries/990101")).toBe(false);

    expect(weakSignals(requests)).toEqual([{ itemKind: "grammar", itemRef: "12", reason: "lookup" }]);
  });

  it("lifting over the dimmed Dictionary row takes nothing", async () => {
    const { client } = fakeApi();
    await openStory(client);

    await pressAndHold(0, 3); // しました: Dictionary disabled
    releaseAt(0, 3, 300, 337); // over the (dimmed) Dictionary row

    await waitFor(() => expect(screen.queryByLabelText("Lookup menu")).toBeNull());
    expect(screen.queryByTestId("dictionary-window")).toBeNull();
    expect(screen.queryByTestId("grammar-window")).toBeNull();
  });

  it("release on Dictionary opens the entry window with senses, JLPT and the pitch caption", async () => {
    const { client } = fakeApi();
    await openStory(client);

    await pressAndHold(1, 0); // みせ
    releaseAt(1, 0, 300, 337); // over Dictionary

    const win = await screen.findByTestId("dictionary-window");
    expect(within(win).getByText("店")).toBeTruthy();
    expect(within(win).getByText("noun")).toBeTruthy();
    expect(within(win).getByText("shop")).toBeTruthy();
    expect(within(win).getByText("store")).toBeTruthy();
    expect(within(win).getByText("N5")).toBeTruthy();
    expect(within(win).getByText(/heiban \(flat\)/)).toBeTruthy();
  });

  it("answers a comprehension question once and locks the buttons", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(screen.getByRole("button", { name: "Answer 1: がっこう" }));
    expect(await screen.findByText("Correct.")).toBeTruthy();
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path === "/stories/st-1/answers")).toBe(true),
    );
    expect(requests.find((r) => r.path === "/stories/st-1/answers")?.body).toEqual({
      questionIndex: 0,
      answerIndex: 0,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Answer 2: いえ" }).getAttribute("aria-disabled")).toBe("true"));
  });
});

describe("Reading Panel (mobile)", () => {
  it("revealing the blurred translation saves the preference and signals the Focus Set", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    // Select sentence 0 with a quick tap.
    fireEvent.mouseDown(token(0, 0), { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(token(0, 0), { clientX: 300, clientY: 300 });
    const translation = await screen.findByLabelText("Sentence Translation");
    expect(screen.getByText("Translation hidden — tap to show")).toBeTruthy();

    fireEvent.click(translation);

    await waitFor(() => expect(requests.some((r) => r.method === "PUT" && r.path === "/reading-settings")).toBe(true));
    // The whole settings object travels, hold threshold included.
    expect(requests.find((r) => r.method === "PUT" && r.path === "/reading-settings")?.body).toEqual({
      blurTranslation: false,
      lookupHoldMs: HOLD_MS,
    });
    await waitFor(() => expect(screen.queryByText("Translation hidden — tap to show")).toBeNull());
    await waitFor(() => expect(weakSignals(requests)).toEqual([
      { itemKind: "vocabulary", itemRef: "990101", reason: "translation_unblur" },
      { itemKind: "grammar", itemRef: "12", reason: "translation_unblur" },
    ]));
  });

  it("a failed blur save says so and keeps the translation hidden", async () => {
    const { client } = fakeApi({ failReadingPut: true });
    await openStory(client);

    fireEvent.mouseDown(token(0, 0), { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(token(0, 0), { clientX: 300, clientY: 300 });
    fireEvent.click(await screen.findByLabelText("Sentence Translation"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/server exploded/)).toBeTruthy();
    expect(screen.getByText("Translation hidden — tap to show")).toBeTruthy();
  });
});

describe("Reading Panel placement, modes and scroll lock (review fixes)", () => {
  it("renders the Reading Panel above the story, not below it", async () => {
    const { client } = fakeApi();
    await openStory(client);

    const panel = await screen.findByLabelText("Reading Panel");
    const storyText = screen.getByLabelText("Story text");
    // The story must come after the panel in document order: the panel is the
    // fixed area on top and the story scrolls under it.
    expect(panel.compareDocumentPosition(storyText) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("after a held press released outside every option, the panel shows the sentence, not the stale word", async () => {
    const { client } = fakeApi();
    await openStory(client);
    const panel = await screen.findByLabelText("Reading Panel");

    await pressAndHold(0, 0);
    // Held: word-mode — the Lookup details live in the panel's one fixed box,
    // and the sentence is not shown beside them.
    expect(within(panel).getByText("Word meaning")).toBeTruthy();
    expect(within(panel).queryByLabelText("Sentence Translation")).toBeNull();

    releaseAt(0, 0, 5, 5); // outside every option: the menu just closes
    await waitFor(() => expect(screen.queryByLabelText("Lookup menu")).toBeNull());
    expect(await within(panel).findByLabelText("Sentence Translation")).toBeTruthy();
    expect(within(panel).queryByText("Word meaning")).toBeNull();
  });

  it("Back closing the menu also hands the panel back to sentence-mode", async () => {
    const { client } = fakeApi();
    await openStory(client);
    const panel = await screen.findByLabelText("Reading Panel");

    await pressAndHold(0, 0);
    expect(within(panel).getByText("Word meaning")).toBeTruthy();
    back.press();
    await waitFor(() => expect(screen.queryByLabelText("Lookup menu")).toBeNull());
    expect(await within(panel).findByLabelText("Sentence Translation")).toBeTruthy();
    expect(within(panel).queryByText("Word meaning")).toBeNull();
  });

  it("the panel is one fixed-height container in both modes", async () => {
    const { client } = fakeApi();
    await openStory(client);

    // Read the height off what react-native-web rendered (r-* class CSS):
    // one fixed dp constant, the same in sentence-mode and word-mode.
    const panelHeight = () => {
      const el = screen.getByTestId("reading-panel");
      for (const cls of Array.from(el.classList)) {
        if (!cls.startsWith("r-")) continue;
        for (const style of Array.from(document.querySelectorAll("style"))) {
          for (const rule of Array.from((style as HTMLStyleElement).sheet?.cssRules ?? [])) {
            const r = rule as CSSStyleRule;
            if (r.selectorText === `.${cls}` && r.style.getPropertyValue("height")) {
              return r.style.getPropertyValue("height");
            }
          }
        }
      }
      return undefined;
    };
    const sentenceModeHeight = panelHeight();
    expect(sentenceModeHeight).toBe("148px");

    fireEvent.mouseDown(token(0, 0), { clientX: 300, clientY: 300 });
    expect(panelHeight()).toBe(sentenceModeHeight);
    fireEvent.mouseUp(token(0, 0), { clientX: 300, clientY: 300 });
  });

  it("the story stays scrollable through a press-and-swipe, and freezes only once the menu is up", async () => {
    const { client } = fakeApi();
    await openStory(client);

    // RNW implements scrollEnabled by flipping the scroll container's own
    // overflow (auto ↔ hidden) — that is what the browser uses to decide who
    // pans, so read it off the rendered CSS rather than component props.
    const scrollable = () => {
      const el = screen.getByTestId("story-scroll");
      for (const cls of Array.from(el.classList)) {
        if (!cls.startsWith("r-overflowY")) continue;
        for (const style of Array.from(document.querySelectorAll("style"))) {
          for (const rule of Array.from((style as HTMLStyleElement).sheet?.cssRules ?? [])) {
            const r = rule as CSSStyleRule;
            if (r.selectorText === `.${cls}`) return r.style.getPropertyValue("overflow-y") === "auto";
          }
        }
      }
      return false;
    };
    expect(scrollable()).toBe(true);

    // Pressing a token primes the hold but must NOT freeze the story
    // (issue #14 review, major 1): a swipe that starts on text belongs to
    // the ScrollView, not to the word under the finger.
    fireEvent.mouseDown(token(0, 0), { clientX: 300, clientY: 300 });
    expect(scrollable()).toBe(true);

    // A pre-threshold drag — the beginning of a scroll — changes nothing.
    fireEvent.mouseMove(token(0, 0), { clientX: 300, clientY: 240 });
    expect(scrollable()).toBe(true);

    // Only once the hold elapses and the Lookup Menu opens does the scroll
    // freeze — that is what protects slide-and-release.
    await act(async () => {
      await new Promise((r) => setTimeout(r, HOLD_MS + 30));
    });
    expect(screen.getByLabelText("Lookup menu")).toBeTruthy();
    expect(scrollable()).toBe(false);

    fireEvent.mouseUp(token(0, 0), { clientX: 5, clientY: 5 }); // released outside: cancel
    expect(scrollable()).toBe(true);
  });

  it("a token hands the touch to a scrolling parent until its menu opens", async () => {
    const { client } = fakeApi();
    await openStory(client);

    // The token's responder wiring is what a real host consults when the
    // ScrollView wants to pan a swipe: true = "yes, steal it" (scrolling
    // starting on text works), false = the menu gesture survives to the
    // release. Walk the fiber from the rendered token to the handler the
    // shipped reader passed down.
    const terminationRequest = () => {
      let f = fiberFrom(token(0, 1));
      while (f) {
        const h = f.memoizedProps?.onResponderTerminationRequest;
        if (typeof h === "function") return (h as () => boolean)();
        f = f.return;
      }
      throw new Error("token has no onResponderTerminationRequest wiring");
    };

    fireEvent.mouseDown(token(0, 1), { clientX: 300, clientY: 300 });
    expect(terminationRequest()).toBe(true); // before the hold: a swipe may take over
    fireEvent.mouseUp(token(0, 1), { clientX: 300, clientY: 300 });

    await pressAndHold(0, 1);
    expect(terminationRequest()).toBe(false); // menu up: nothing steals the gesture
    releaseAt(0, 1, 5, 5);
  });

  it("the shipped reader runs the gesture through the pure reduceHold machine", async () => {
    const { client } = fakeApi();
    const machine = vi.mocked(reduceHold);
    machine.mockClear();
    await openStory(client);

    // Press, hold and cancel all go through holdMenu.reduceHold — the
    // machine's own unit tests therefore guard the shipped gesture, not a
    // parallel copy of it (issue #14 review, major 2).
    fireEvent.mouseDown(token(0, 0), { clientX: 300, clientY: 300 });
    const press = machine.mock.calls.find(([, event]) => event.type === "press");
    expect(press?.[1]).toMatchObject({ token: { sentence: 0, index: 0 }, x: 300, y: 300 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, HOLD_MS + 30));
    });
    const opened = machine.mock.calls.findIndex(([, event]) => event.type === "holdElapsed");
    expect(opened).toBeGreaterThanOrEqual(0);
    expect(machine.mock.results[opened].value.phase).toBe("menu");

    releaseAt(0, 0, 5, 5); // released outside every option
    expect(machine.mock.calls.some(([, event]) => event.type === "cancel")).toBe(true);
  });

  it("a failed dictionary lookup dims Dictionary, opens no window, and the next hold retries", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    // で has an entSeq, but the fake API 404s it — the lookup comes back cold.
    await pressAndHold(0, 1);
    const menu = screen.getByLabelText("Lookup menu");
    expect(within(menu).getByTestId("menu-option-dictionary").getAttribute("aria-disabled")).toBe("true");
    const fetches = () => requests.filter((r) => r.path === "/dictionary/entries/990102").length;
    expect(fetches()).toBe(1);

    // Hardware Back with the dimmed row: the menu is the ONLY layer to close.
    // No phantom Dictionary window was pushed over a cold entry (issue #14
    // review, major 3) — the reader is still the story, not an invisible card.
    back.press();
    await waitFor(() => expect(screen.queryByLabelText("Lookup menu")).toBeNull());
    expect(screen.queryByTestId("dictionary-window")).toBeNull();
    expect(screen.getByTestId("back-to-stories")).toBeTruthy();
    fireEvent.mouseUp(token(0, 1), { clientX: 300, clientY: 300 }); // finger lifts after Back

    // The failure is not remembered forever: the next press retries the fetch.
    await pressAndHold(0, 1);
    await waitFor(() => expect(fetches()).toBe(2));
    releaseAt(0, 1, 5, 5);
  });

  it("closing a Dictionary window keeps a successful entry cached — × and Back alike", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);
    const fetches = () => requests.filter((r) => r.path === "/dictionary/entries/990101").length;

    // Open the window (slide-release on Dictionary), close it with the ×.
    await pressAndHold(0, 0);
    releaseAt(0, 0, 300, 312);
    await screen.findByTestId("dictionary-window");
    fireEvent.click(screen.getByLabelText("Close"));
    await waitFor(() => expect(screen.queryByTestId("dictionary-window")).toBeNull());
    expect(fetches()).toBe(1); // primed once by the press

    // Open it again and close with hardware Back: the same path, the same
    // result — a good entry is NOT dropped (no refetch flicker).
    await pressAndHold(0, 0);
    releaseAt(0, 0, 300, 312);
    await screen.findByTestId("dictionary-window");
    back.press();
    await waitFor(() => expect(screen.queryByTestId("dictionary-window")).toBeNull());

    // A third hold reopens the window from the cache: still one fetch.
    await pressAndHold(0, 0);
    releaseAt(0, 0, 300, 312);
    expect(await screen.findByTestId("dictionary-window")).toBeTruthy();
    expect(fetches()).toBe(1);
    fireEvent.click(screen.getByLabelText("Close"));
  });

  it("the four token classes get underlines that survive Android: colour + weight, no iOS-only props", async () => {
    const { client } = fakeApi();
    await openStory(client);

    const known = styleOfTokenSurface("token-0-0"); // がっこう — Known Item
    const unknown = styleOfTokenSurface("token-0-1"); // で — unknown with an entry
    const unlinked = styleOfTokenSurface("token-0-2"); // べんきょう — no entry
    const focusGrammar = styleOfTokenSurface("token-0-3"); // しました — inside the Focus Grammar span

    // textDecorationStyle/textDecorationColor are iOS-only in RN: using them
    // on Android collapses every underline to the same solid line, so the
    // mapping must never emit them.
    for (const style of [known, unknown, unlinked, focusGrammar]) {
      expect(style).not.toHaveProperty("textDecorationStyle");
      expect(style).not.toHaveProperty("textDecorationColor");
    }

    expect(known.textDecorationLine).toBe("underline");
    expect(unknown.textDecorationLine).toBe("underline");
    expect(unlinked.textDecorationLine ?? "none").toBe("none");
    expect(focusGrammar.textDecorationLine).toBe("underline");
    // Android paints the underline in the text's colour, so the colour (and
    // for Focus Grammar the weight) carries the distinction the web draws
    // with line styles.
    expect(known.color).not.toBe(unknown.color);
    expect(focusGrammar.color).toBe("#5b21b6");
    expect(focusGrammar.fontWeight).toBe("600");
  });
});

describe("hardware Back in the reader (mobile)", () => {
  it("closes the sheet, then the window, then the menu, then the story", async () => {
    const { client } = fakeApi();
    await openStory(client);

    // Sheet.
    await pressAndHold(0, 0);
    releaseAt(0, 0, 300, 487);
    await screen.findByTestId("save-list-l1");
    back.press();
    await waitFor(() => expect(screen.queryByTestId("save-list-l1")).toBeNull());
    expect(screen.getByTestId("back-to-stories")).toBeTruthy();

    // Window.
    await pressAndHold(1, 0);
    releaseAt(1, 0, 300, 337);
    await screen.findByTestId("dictionary-window");
    back.press();
    await waitFor(() => expect(screen.queryByTestId("dictionary-window")).toBeNull());

    // Menu.
    await pressAndHold(0, 1); // で
    await screen.findByLabelText("Lookup menu");
    back.press();
    await waitFor(() => expect(screen.queryByLabelText("Lookup menu")).toBeNull());
    expect(screen.getByTestId("back-to-stories")).toBeTruthy();

    // Nothing open: Back leaves the reader back to Today's Story, where it
    // was opened from.
    back.press();
    await waitFor(() => expect(screen.queryByTestId("back-to-stories")).toBeNull());
    expect(await screen.findByRole("button", { name: "View all stories" })).toBeTruthy();
  });

  it("the header Back returns to Today's Story when the Story opened from there", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(screen.getByTestId("back-to-stories"));
    await waitFor(() => expect(screen.queryByTestId("back-to-stories")).toBeNull());
    expect(await screen.findByRole("button", { name: "Read today’s story" })).toBeTruthy();
  });

  it("the header Back returns to the Library when the Story opened from there", async () => {
    const { client } = fakeApi();
    await openLibrary(client);
    fireEvent.click(screen.getByTestId("story-row-st-1"));
    await screen.findByTestId("back-to-stories");

    fireEvent.click(screen.getByTestId("back-to-stories"));
    await waitFor(() => expect(screen.queryByTestId("back-to-stories")).toBeNull());
    expect(await screen.findByTestId("story-row-st-1")).toBeTruthy();
  });
});
