import type { ApiClient } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeBackHandler, type FakeBackHandler } from "../test/back-handler-fake.ts";
import { setBackHandlerForTests } from "./hardwareBack.ts";
import type { Rect } from "./reader/holdMenu.ts";
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
  opts: { blurTranslation?: boolean; failReadingPut?: boolean } = {},
) {
  const storyView = {
    id: "st-1",
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

  const itemLists = [
    { id: "l1", name: "Saved", boosting: true, isDefault: true, itemCount: 1 },
    { id: "l2", name: "Travel", boosting: false, isDefault: false, itemCount: 3 },
  ];

  const fetchImpl = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url);
    const body = request.body ? await request.json() : null;
    requests.push({ method: request.method, path: pathname, body });
    if (pathname === "/stories" && request.method === "GET") return json(200, page);
    if (pathname === "/stories/st-1" && request.method === "GET") return json(200, storyView);
    if (pathname === "/stories/st-1/rate" && request.method === "POST") return new Response(null, { status: 204 });
    if (pathname === "/stories/st-1/answers" && request.method === "POST")
      return json(200, { correct: true, practiceRecorded: true });
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

function renderStories(client: ApiClient) {
  return render(
    <Stories
      client={client}
      measure={(testID) => RECTS[testID] ?? null}
      screenSize={SCREEN}
    />,
  );
}

/** Library → open story → the reader's fetches (reading settings, lists) settled. */
async function openStory(client: ApiClient) {
  renderStories(client);
  fireEvent.click(await screen.findByTestId("story-row-st-1"));
  await screen.findByTestId("back-to-library");
  // The reader fetches reading settings + Item Lists on mount; give their
  // mocked responses time to land before any gesture reads them.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

const token = (sentence: number, index: number) => screen.getByTestId(`token-${sentence}-${index}`);

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

describe("Stories library (mobile)", () => {
  it("lists story rows with pager summary and both page buttons disabled on a single page", async () => {
    const { client, requests } = fakeApi();
    renderStories(client);

    const row = await screen.findByTestId("story-row-st-1");
    expect(within(row).getByText("diary")).toBeTruthy();
    expect(within(row).getByText("がっこうでべんきょうしました。…")).toBeTruthy();
    expect(screen.getByText("1–1 of 1")).toBeTruthy();
    const newer = screen.getByRole("button", { name: "Newer stories" });
    const older = screen.getByRole("button", { name: "Older stories" });
    expect(newer.getAttribute("aria-disabled")).toBe("true");
    expect(older.getAttribute("aria-disabled")).toBe("true");
    expect(requests.some((r) => r.method === "GET" && r.path === "/stories")).toBe(true);
  });

  it("rates a story from its library row", async () => {
    const { client, requests } = fakeApi();
    renderStories(client);
    await screen.findByTestId("story-row-st-1");

    fireEvent.click(screen.getByRole("button", { name: "Rate up" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.path === "/stories/st-1/rate")).toBe(true));
    expect(requests.find((r) => r.path === "/stories/st-1/rate")?.body).toBe("up");
  });
});

describe("Story reader gestures (mobile)", () => {
  it("a quick tap selects the sentence and primes the Lookup row without menu or Weak Signal", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.mouseDown(token(0, 0), { clientX: 300, clientY: 300 });
    fireEvent.mouseUp(token(0, 0), { clientX: 300, clientY: 300 });

    // Sentence selected: its (blurred) translation row is up in the panel.
    expect(await screen.findByLabelText("Sentence Translation")).toBeTruthy();
    // The Lookup row shows the pressed word; the Focus Set gloss is there
    // first, and the dictionary entry fills in the fuller gloss line.
    expect(screen.getByText("Word meaning")).toBeTruthy();
    await waitFor(() => expect(requests.some((r) => r.path === "/dictionary/entries/990101")).toBe(true));
    expect(await screen.findByText("school, colloquial reading…")).toBeTruthy();

    // Released before the threshold: no menu, no Weak Signal.
    expect(screen.queryByLabelText("Lookup menu")).toBeNull();
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
    expect(screen.getByTestId("back-to-library")).toBeTruthy();

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
    expect(screen.getByTestId("back-to-library")).toBeTruthy();

    // Nothing open: Back leaves the reader to the library.
    back.press();
    await waitFor(() => expect(screen.queryByTestId("back-to-library")).toBeNull());
    expect(await screen.findByTestId("story-row-st-1")).toBeTruthy();
  });

  it("the header Back returns to the library", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(screen.getByTestId("back-to-library"));
    await waitFor(() => expect(screen.queryByTestId("back-to-library")).toBeNull());
    expect(await screen.findByTestId("story-row-st-1")).toBeTruthy();
  });
});
