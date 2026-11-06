// The web Story reader (issue #77), driven through the DOM the way a Learner
// drives it: hover and focus for the Lookup, click and Enter for the menu, the
// arrow keys for sentences, and a real selection for the copy. The network is a
// stateful fake of the API; the reader itself is the real component.
import { createApiClient, type ApiClient, type Story } from "@vjt/api-client";
import { useStory } from "@vjt/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router";

import { storyTextSizeStore } from "../storysize/index.ts";
import type { StoryTextSize } from "../storysize/store.ts";
import { StoryReader } from "./StoryReader.tsx";

// Radix popper and dialog measure through ResizeObserver, which jsdom lacks.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  storyTextSizeStore.setSize("M");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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
  kanji: [],
};

function makeStory(overrides: Partial<Story> = {}): Story {
  return {
    id: "st-1",
    title: "がっこうの 一日",
    titleEn: "A Day at School",
    theme: "school life",
    origin: "automatic",
    genre: "diary",
    text: "がっこうで勉強しました。みせにいきました。",
    createdAt: "2026-11-01T09:00:00Z",
    attempts: 1,
    sentences: [
      {
        ja: "がっこうで勉強しました。",
        en: "I studied at school.",
        tokens: [
          { surface: "がっこう", start: 0, end: 4, reading: "がっこう", entSeq: 990101, tag: "known", srsLevel: 4, showFurigana: false },
          { surface: "で", start: 4, end: 5, reading: "で", tag: "unknown", showFurigana: false },
          { surface: "勉強", start: 5, end: 7, reading: "べんきょう", entSeq: 990104, tag: "unknown", showFurigana: true },
          { surface: "しました", start: 7, end: 11, reading: "しました", tag: "unknown", showFurigana: false },
        ],
        grammarSpans: [
          {
            start: 7,
            end: 11,
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
          { surface: "いきました", start: 3, end: 7, reading: "いきました", tag: "unknown", showFurigana: false },
        ],
        grammarSpans: [],
      },
    ],
    questions: [{ position: 0, promptJa: "どこで べんきょう しましたか。", optionsJa: ["がっこう", "いえ"] }],
    vocabItems: [
      { entSeq: 990101, ja: "学校", en: "school", isKnown: true, isFocus: false },
      { entSeq: 990103, ja: "店", en: "shop", isKnown: false, isFocus: true },
    ],
    ...overrides,
  } as Story;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

/** A stateful fake of the API for one Story. */
function fakeApi(
  opts: {
    story?: Story;
    blurTranslation?: boolean;
    failReadingPut?: number;
    failReadPut?: number;
    failRate?: boolean;
    library?: Story[];
  } = {},
) {
  const story = opts.story ?? makeStory();
  const requests: Recorded[] = [];
  let readingPutFailures = opts.failReadingPut ?? 0;
  let readPutFailures = opts.failReadPut ?? 0;
  const lists = [
    { id: "l1", name: "Saved", boosting: true, isDefault: true, itemCount: 1 },
    { id: "l2", name: "Travel", boosting: false, isDefault: false, itemCount: 3 },
  ];

  const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const text = method === "GET" ? "" : await req.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    requests.push({ method, path, body });

    if (path === "/reading-settings" && method === "GET") {
      return json(200, { blurTranslation: opts.blurTranslation ?? true, lookupHoldMs: 800 });
    }
    if (path === "/reading-settings" && method === "PUT") {
      if (readingPutFailures > 0) {
        readingPutFailures -= 1;
        return json(500, { message: "the server is busy" });
      }
      return json(200, body);
    }
    if (path === "/item-lists" && method === "GET") return json(200, { items: lists, defaultListId: "l1" });
    if (path === "/item-lists" && method === "POST") {
      return json(201, { id: "l3", name: (body as { name: string }).name, boosting: false, isDefault: false, itemCount: 0 });
    }
    if (/^\/item-lists\/[^/]+\/items$/.test(path) && method === "POST") return new Response(null, { status: 204 });
    if (path === "/weak-signals" && method === "POST") return new Response(null, { status: 204 });
    if (path === "/stories/st-1/read" && method === "PUT") {
      if (readPutFailures > 0) {
        readPutFailures -= 1;
        return json(503, { message: "the server is offline" });
      }
      return new Response(null, { status: 204 });
    }
    if (path === "/stories/st-1/rate" && method === "POST") {
      if (opts.failRate) return json(503, { message: "the server is offline" });
      return new Response(null, { status: 204 });
    }
    if (path === "/stories/st-1/answers" && method === "POST") {
      return json(200, { correct: true, practiceRecorded: true });
    }
    if (path === "/dictionary/entries/990101") return json(200, SCHOOL_ENTRY);
    if (path === "/dictionary/entries/990103") return json(404, { message: "no such entry" });
    if (path === "/stories/st-1" && method === "GET") return json(200, story);
    if (path === "/stories/today") return json(404, { message: "none" });
    if (path === "/stories") return json(200, { items: opts.library ?? [story], total: (opts.library ?? [story]).length, limit: 20, offset: 0 });
    if (path === "/story-settings") return json(200, { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "" });
    return json(404, { message: "not found" });
  };

  const client: ApiClient = createApiClient({ baseUrl: "http://api.test", fetch });
  return { client, requests };
}

const requestsTo = (requests: Recorded[], path: string, method?: string) =>
  requests.filter((r) => r.path === path && (method === undefined || r.method === method));

function ReaderHarness({ client }: { client: ApiClient }) {
  const view = useStory(client);
  const { openStory } = view;
  useEffect(() => {
    void openStory("st-1");
  }, [openStory]);
  if (!view.story) return <p>Loading the Story</p>;
  return <StoryReader key={view.story.id} client={client} view={view} story={view.story} />;
}

// Where the reader's footer Prev/Next actually navigate to; the probe sits
// inside the router and records every pathname it lands on.
function LocationProbe({ report }: { report: (path: string) => void }) {
  const location = useLocation();
  useEffect(() => {
    report(location.pathname);
  }, [location.pathname, report]);
  return null;
}

async function renderReader(opts: Parameters<typeof fakeApi>[0] = {}) {
  const api = fakeApi(opts);
  const paths: string[] = [];
  const view = render(
    <MemoryRouter>
      <LocationProbe report={(p) => paths.push(p)} />
      <ReaderHarness client={api.client} />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { level: 1 });
  return { ...api, paths, ...view };
}

const token = (container: HTMLElement, sentence: number, index: number) =>
  container.querySelector<HTMLElement>(`[data-token="${sentence}-${index}"]`) as HTMLElement;

describe("Story reader: text", () => {
  it("renders the Story text with furigana as <ruby> over the base text", async () => {
    const { container } = await renderReader();
    const ruby = container.querySelector("ruby");
    expect(ruby?.textContent).toBe("勉強べんきょう");
    expect(ruby?.querySelector("rt")?.textContent).toBe("べんきょう");
    // A word below the threshold has no ruby at all.
    expect(token(container, 0, 0).querySelector("ruby")).toBeNull();
  });

  it("renders Story text, glosses and AI output as text nodes, never as HTML", async () => {
    const hostile = "<img src=x onerror=alert(1)>";
    const story = makeStory({
      title: hostile,
      titleEn: hostile,
      sentences: [
        {
          ja: `${hostile}。`,
          en: hostile,
          tokens: [],
          grammarSpans: [],
        },
      ],
      questions: [{ position: 0, promptJa: hostile, optionsJa: [hostile, "いえ"] }],
    });
    const { container } = await renderReader({ story });
    expect(container.querySelector("img")).toBeNull();
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(hostile);
    expect(container.textContent).toContain(hostile);
    // The Reading Panel's sentence and its hidden translation are rendered the
    // same way: text, never markup (issue #77 review).
    fireEvent.click(container.querySelector('[data-sentence="0"]') as HTMLElement);
    const translationButton = screen.getByRole("button", { name: "Sentence Translation" });
    expect(translationButton.textContent).toContain(hostile);
    expect(document.querySelector("img[onerror]")).toBeNull();
  });

  it("the Story Title's English translation is hidden until revealed", async () => {
    await renderReader();
    const toggle = screen.getByRole("button", { name: /A Day at School/ });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("keeps the English meta line exactly as it was before the string table", async () => {
    // The pre-#125 line: the raw Genre id, the two Origin words, and a
    // toDateString() date — not the table's capitalised Genre or Intl date.
    const expected = `diary · Automatic · ${new Date("2026-11-01T09:00:00Z").toDateString()}`;
    await renderReader();
    expect(await screen.findByText(expected)).toBeTruthy();
  });

  it.each<StoryTextSize>(["S", "M", "L", "XL"])("sets the furigana step for Story text size %s", async (size) => {
    storyTextSizeStore.setSize(size);
    const { container } = await renderReader();
    const rt = container.querySelector("rt");
    expect(rt?.className).toContain(`text-furigana-${size.toLowerCase()}`);
    expect(container.querySelector('[data-testid="story-column"]')?.getAttribute("style")).toContain("--story-text-size");
  });
});

describe("Story reader: marks", () => {
  it("marks each word by its state: no mark for a Known Item, underline for a linked word, highlight for a Grammar Span", async () => {
    const { container } = await renderReader();
    expect(token(container, 0, 0).className).not.toContain("underline");
    expect(token(container, 0, 2).className).toContain("decoration-lookup-mark");
    expect(token(container, 0, 3).className).toContain("bg-grammar-focus");
    // みせ is a Focus Set item, so its underline takes the Focus colour.
    expect(token(container, 1, 0).className).toContain("decoration-focus");
  });

  it("selects a sentence's background on the selected sentence only", async () => {
    const { container } = await renderReader();
    expect(container.querySelector(".bg-selected-sentence")).toBeNull();
    fireEvent.click(container.querySelector('[data-sentence="1"]') as HTMLElement);
    expect(container.querySelector('[data-sentence="1"]')?.className).toContain("bg-selected-sentence");
  });
});

describe("Story reader: Lookup", () => {
  it("hovering a linked word shows its Lookup in the Reading Panel", async () => {
    const { container } = await renderReader();
    fireEvent.mouseEnter(token(container, 0, 0));
    const lookup = await screen.findByTestId("panel-lookup");
    expect(within(lookup).getByText("がっこう")).toBeTruthy();
    expect(within(lookup).getByText("school")).toBeTruthy();
    fireEvent.mouseLeave(token(container, 0, 0));
    await waitFor(() => expect(screen.queryByTestId("panel-lookup")).toBeNull());
  });

  it("a particle with a Grammar Catalogue hint shows its point on hover, with no menu and no Weak Signal (issue #98)", async () => {
    const story = makeStory({
      sentences: [
        {
          ja: "は",
          en: "topic",
          tokens: [
            {
              surface: "は",
              start: 0,
              end: 1,
              reading: "は",
              tag: "unknown",
              showFurigana: false,
              grammarHint: { grammarPointId: "7", pattern: "は", meaning: "topic marker", jlptLevel: "N5" },
            },
          ],
          grammarSpans: [],
        },
      ],
      vocabItems: [],
    });
    const { container, requests } = await renderReader({ story });
    const particle = token(container, 0, 0);
    expect(particle.tabIndex).toBe(0); // the hint makes it reachable
    fireEvent.mouseEnter(particle);
    const lookup = await screen.findByTestId("panel-lookup");
    expect(within(lookup).getByText("topic marker")).toBeTruthy();
    fireEvent.click(particle);
    expect(screen.queryByRole("button", { name: "Dictionary" })).toBeNull(); // no Lookup Menu
    expect(particle.getAttribute("aria-expanded")).toBeNull(); // no popup to expand
    expect(particle.getAttribute("aria-haspopup")).toBeNull();
    expect(requestsTo(requests, "/weak-signals", "POST")).toHaveLength(0);
  });

  it("a Lookup shows the current SRS Level of its word, and of its Grammar Point, and nothing when there is none", async () => {
    const hint = (srsLevel?: number) => ({
      grammarPointId: "7",
      pattern: "は",
      meaning: "topic marker",
      jlptLevel: "N5" as const,
      ...(srsLevel === undefined ? {} : { srsLevel }),
    });
    const story = makeStory({
      sentences: [
        {
          ja: "はは",
          en: "topic",
          tokens: [
            { surface: "は", start: 0, end: 1, reading: "は", tag: "unknown", showFurigana: false, grammarHint: hint(5) },
            { surface: "は", start: 1, end: 2, reading: "は", tag: "unknown", showFurigana: false, grammarHint: hint() },
          ],
          grammarSpans: [],
        },
      ],
      vocabItems: [],
    });
    const { container } = await renderReader({ story });
    fireEvent.mouseEnter(token(container, 0, 0));
    expect(within(await screen.findByTestId("panel-lookup")).getByText("SRS 5")).toBeTruthy();
    fireEvent.mouseLeave(token(container, 0, 0));
    await waitFor(() => expect(screen.queryByTestId("panel-lookup")).toBeNull());
    fireEvent.mouseEnter(token(container, 0, 1));
    const bare = await screen.findByTestId("panel-lookup");
    expect(within(bare).queryByText(/^SRS /)).toBeNull();
  });

  it("the dictionary Lookup row shows the word's SRS Level", async () => {
    const { container } = await renderReader();
    fireEvent.mouseEnter(token(container, 0, 0));
    const lookup = await screen.findByTestId("panel-lookup");
    expect(within(lookup).getByText("SRS 4")).toBeTruthy();
  });

  it("focusing a word (keyboard) shows the same Lookup and selects its sentence", async () => {
    const { container } = await renderReader();
    fireEvent.focus(token(container, 0, 0));
    expect(await screen.findByTestId("panel-lookup")).toBeTruthy();
    expect(container.querySelector('[data-sentence="0"]')?.className).toContain("bg-selected-sentence");
  });

  it("Tab reaches exactly the words with a Dictionary Entry or a Grammar Span", async () => {
    const { container } = await renderReader();
    expect(token(container, 0, 0).tabIndex).toBe(0); // linked
    expect(token(container, 0, 1).tabIndex).toBe(-1); // plain particle: not in the tab order
    expect(token(container, 0, 3).tabIndex).toBe(0); // inside a Grammar Span
  });

  it("a click opens the Lookup Menu next to the word, with the Grammar option for a span", async () => {
    const { container } = await renderReader();
    fireEvent.click(token(container, 0, 3));
    const menu = await screen.findByRole("button", { name: "Grammar" });
    expect(menu).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save to…" })).toBeTruthy();
    expect(token(container, 0, 3).getAttribute("aria-expanded")).toBe("true");
  });

  it("Dictionary opens the Dictionary Entry with every sense", async () => {
    const { container } = await renderReader();
    fireEvent.click(token(container, 0, 0));
    fireEvent.click(await screen.findByRole("button", { name: "Dictionary" }));
    const dialog = await screen.findByTestId("dictionary-window");
    expect(within(dialog).getByText("school")).toBeTruthy();
    expect(within(dialog).getByText("colloquial reading")).toBeTruthy();
    expect(within(dialog).getByText("downstep after mora 3")).toBeTruthy();
  });

  it("the Grammar Point opens its detail dialog without a request", async () => {
    const { container, requests } = await renderReader();
    const before = requests.length;
    fireEvent.click(token(container, 0, 3));
    fireEvent.click(await screen.findByRole("button", { name: "Grammar" }));
    const dialog = await screen.findByTestId("grammar-window");
    expect(within(dialog).getByText("completing something; unfortunately doing")).toBeTruthy();
    expect(requests.slice(before).some((r) => r.path.startsWith("/dictionary/"))).toBe(false);
  });

  it("the menu closes on Escape", async () => {
    const { container } = await renderReader();
    fireEvent.click(token(container, 0, 0));
    await screen.findByRole("button", { name: "Dictionary" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save to…" })).toBeNull());
  });
});

describe("Story reader: saving to Item Lists", () => {
  it("Save writes to the Default List and says which list it went to", async () => {
    const { container, requests } = await renderReader();
    fireEvent.click(token(container, 0, 0));
    // Save waits for the Item Lists: the row is disabled until they load.
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved to Saved.")).toBeTruthy();
    const saves = requestsTo(requests, "/item-lists/l1/items", "POST");
    expect(saves[0]?.body).toEqual({ itemKind: "vocabulary", itemRef: "990101" });
  });

  it("Save to… saves into the list the Learner picks", async () => {
    const { container, requests } = await renderReader();
    fireEvent.click(token(container, 0, 0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save to…" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save to…" }));
    const dialog = await screen.findByTestId("save-sheet");
    fireEvent.click(await within(dialog).findByTestId("save-list-l2"));
    await waitFor(() => expect(requestsTo(requests, "/item-lists/l2/items", "POST").length).toBe(1));
  });

  it("creating a list saves into it only after the create succeeds", async () => {
    const { container, requests } = await renderReader();
    fireEvent.click(token(container, 0, 0));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save to…" }).hasAttribute("disabled")).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Save to…" }));
    const dialog = await screen.findByTestId("save-sheet");
    fireEvent.change(within(dialog).getByLabelText("New list name"), { target: { value: "Kanji" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create a new list and save" }));
    await waitFor(() => expect(requestsTo(requests, "/item-lists/l3/items", "POST").length).toBe(1));
    expect(requestsTo(requests, "/item-lists", "POST").length).toBe(1);
  });
});

describe("Story reader: translation, keyboard and the footer", () => {
  it("the Sentence Translation starts hidden; Enter reveals the selected sentence's and reports its Focus Set items", async () => {
    const { container, requests } = await renderReader();
    fireEvent.keyDown(screen.getByTestId("story-reader"), { key: "ArrowRight" });
    expect(container.querySelector('[data-sentence="0"]')?.className).toContain("bg-selected-sentence");
    expect(screen.getByTestId("translation-hidden-note")).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("story-reader"), { key: "Enter" });
    await waitFor(() => expect(screen.queryByTestId("translation-hidden-note")).toBeNull());
    const put = requestsTo(requests, "/reading-settings", "PUT")[0];
    expect(put?.body).toEqual({ blurTranslation: false, lookupHoldMs: 800 });
    await waitFor(() =>
      expect(requestsTo(requests, "/weak-signals", "POST")[0]?.body).toEqual({
        signals: [{ itemKind: "grammar", itemRef: "12", reason: "translation_unblur" }],
      }),
    );
  });

  it("Left and Right move the selected sentence and stop at the ends", async () => {
    const { container } = await renderReader();
    const reader = screen.getByTestId("story-reader");
    const selectedIndex = () =>
      [0, 1].find((i) => container.querySelector(`[data-sentence="${i}"]`)?.className.includes("bg-selected-sentence"));
    fireEvent.keyDown(reader, { key: "ArrowRight" });
    expect(selectedIndex()).toBe(0);
    fireEvent.keyDown(reader, { key: "ArrowRight" });
    expect(selectedIndex()).toBe(1);
    fireEvent.keyDown(reader, { key: "ArrowRight" });
    expect(selectedIndex()).toBe(1);
    fireEvent.keyDown(reader, { key: "ArrowLeft" });
    expect(selectedIndex()).toBe(0);
  });

  it("a failed reveal keeps the translation hidden, says so, and Retry sends the save again", async () => {
    const { container } = await renderReader({ failReadingPut: 1 });
    fireEvent.click(container.querySelector('[data-sentence="0"]') as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Sentence Translation" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByTestId("translation-hidden-note")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByTestId("translation-hidden-note")).toBeNull();
  });

  it("Mark read sets the Story as read, and the button reads Unmark read after", async () => {
    const { requests } = await renderReader();
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Unmark read" })).toBeTruthy());
    expect(requestsTo(requests, "/stories/st-1/read", "PUT").length).toBe(1);
  });

  it("a failed mark-read gets a Retry that sends just that PUT again", async () => {
    const { requests } = await renderReader({ failReadPut: 1 });
    fireEvent.click(screen.getByRole("button", { name: "Mark read" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("the server is offline");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requestsTo(requests, "/stories/st-1/read", "PUT").length).toBe(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("button", { name: "Unmark read" })).toBeTruthy();
  });

  it("Rate up sends the rating and shows it pressed", async () => {
    const { requests } = await renderReader();
    fireEvent.click(screen.getByRole("button", { name: "Rate up" }));
    await waitFor(() =>
      expect(requestsTo(requests, "/stories/st-1/rate", "POST")[0]?.body).toBe("up"),
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Rate up" }).getAttribute("aria-pressed")).toBe("true"));
  });

  it("a failed rating gets a Retry that sends it again", async () => {
    const { requests } = await renderReader({ failRate: true });
    fireEvent.click(screen.getByRole("button", { name: "Rate down" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("the server is offline");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requestsTo(requests, "/stories/st-1/rate", "POST").length).toBe(2));
    expect(requestsTo(requests, "/stories/st-1/rate", "POST").every((r) => r.body === "down")).toBe(true);
  });

  it("Prev and Next walk the Library page around the open Story, and stop at the ends", async () => {
    const older = makeStory({ id: "st-0", title: "older" });
    const { paths } = await renderReader({ library: [older, makeStory()] });
    // st-1 sits between st-0 and nothing: Next has nowhere to go.
    await waitFor(() => expect(screen.getByRole("button", { name: "Previous story" }).hasAttribute("disabled")).toBe(false));
    expect(screen.getByRole("button", { name: "Next story" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Previous story" }));
    await waitFor(() => expect(paths[paths.length - 1]).toBe("/stories/st-0"));
  });

  it("a comprehension question answers once: the POST lands, the options lock, the verdict shows", async () => {
    const { requests } = await renderReader();
    const answer = screen.getByRole("button", { name: "Answer 1: がっこう" });
    fireEvent.click(answer);
    await waitFor(() =>
      expect(requestsTo(requests, "/stories/st-1/answers", "POST")[0]?.body).toEqual({ questionIndex: 0, answerIndex: 0 }),
    );
    expect(await screen.findByText("Correct.")).toBeTruthy();
    await waitFor(() =>
      expect(
        [screen.getByRole("button", { name: "Answer 1: がっこう" }), screen.getByRole("button", { name: "Answer 2: いえ" })].every(
          (b) => b.hasAttribute("disabled"),
        ),
      ).toBe(true),
    );
    expect(requestsTo(requests, "/stories/st-1/answers", "POST").length).toBe(1);
  });

  it("links to Practice for this Story", async () => {
    await renderReader();
    const link = screen.getByRole("link", { name: "Practice this Story" });
    expect(link.getAttribute("href")).toBe("/practice?storyId=st-1");
  });
});

describe("Story reader: failed lookups and gestures", () => {
  it("a failed dictionary word is not refetched by repeated hovers, but a press tries once more", async () => {
    const { container, requests } = await renderReader();
    const word = token(container, 1, 0); // みせ, entSeq 990103: the fake answers 404
    const lookups = () => requestsTo(requests, "/dictionary/entries/990103").length;

    fireEvent.mouseEnter(word);
    await waitFor(() => expect(lookups()).toBe(1));
    fireEvent.mouseLeave(word);
    fireEvent.mouseEnter(word);
    fireEvent.mouseLeave(word);
    fireEvent.mouseEnter(word);
    await new Promise((r) => setTimeout(r, 0));
    expect(lookups()).toBe(1); // hovering a failed word costs nothing (issue #77 review)

    // A press still opens the menu and makes one fresh attempt; the Dictionary
    // row stays dimmed until that attempt answers.
    fireEvent.click(word);
    await waitFor(() => expect(lookups()).toBe(2));
    const row = await screen.findByRole("button", { name: "Dictionary" });
    expect(row.hasAttribute("disabled")).toBe(true);
    expect(row.textContent).toContain("The dictionary did not answer");

    // Pressing the same word again closes the menu — a toggle — without spending
    // another request (issue #77 review).
    fireEvent.mouseDown(word);
    fireEvent.mouseUp(word);
    fireEvent.click(word);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save to…" })).toBeNull());
    expect(lookups()).toBe(2);

    // A further press opens it again with one more single attempt.
    fireEvent.mouseDown(word);
    fireEvent.mouseUp(word);
    fireEvent.click(word);
    await screen.findByRole("button", { name: "Save to…" });
    await waitFor(() => expect(lookups()).toBe(3));
  });

  it("re-pressing the word that owns the open menu closes it instead of reopening it", async () => {
    const { container } = await renderReader();
    const word = token(container, 0, 0);
    fireEvent.click(word);
    await screen.findByRole("button", { name: "Dictionary" });
    fireEvent.mouseDown(word, { detail: 1 }); // a real press, before Radix dismisses
    fireEvent.mouseUp(word);
    fireEvent.click(word, { detail: 1 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Dictionary" })).toBeNull());
    expect(word.getAttribute("aria-expanded")).toBe("false");
  });

  it("a double click is exactly one toggle: its second press never closes the menu", async () => {
    const { container } = await renderReader();
    const word = token(container, 0, 0);
    fireEvent.mouseDown(word, { detail: 1 }); // the first press of the double click…
    fireEvent.mouseUp(word);
    fireEvent.click(word, { detail: 1 }); // …opens
    await screen.findByRole("button", { name: "Dictionary" });
    fireEvent.mouseDown(word, { detail: 2 }); // the browser counts the second press
    fireEvent.mouseUp(word);
    fireEvent.click(word, { detail: 2 }); // …and its click is dropped
    await screen.findByRole("button", { name: "Dictionary" }); // the same menu, never close-and-reopen
    expect(word.getAttribute("aria-expanded")).toBe("true");
  });

  it("a text selection swallows the pointer click, but Enter on the word still opens its menu", async () => {
    const { container } = await renderReader();
    const word = token(container, 0, 0);
    const range = document.createRange();
    range.selectNodeContents(word);
    const selection = window.getSelection();
    act(() => {
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    fireEvent.click(word);
    expect(screen.queryByRole("button", { name: "Dictionary" })).toBeNull(); // copying is not a press
    fireEvent.keyDown(word, { key: "Enter" });
    await screen.findByRole("button", { name: "Dictionary" });
    selection?.removeAllRanges();
  });

  it("opening a word's menu reports its Lookup signal exactly once", async () => {
    const { container, requests } = await renderReader();
    const word = token(container, 0, 0);
    fireEvent.click(word);
    await waitFor(() =>
      expect(requestsTo(requests, "/weak-signals", "POST")[0]?.body).toEqual({
        signals: [{ itemKind: "vocabulary", itemRef: "990101", reason: "lookup" }],
      }),
    );
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save to…" })).toBeNull());
    fireEvent.click(word); // the same word again: the signal is not sent twice
    await waitFor(() => expect(screen.queryByRole("button", { name: "Save to…" })).toBeTruthy());
    expect(requestsTo(requests, "/weak-signals", "POST").length).toBe(1);
  });

  it("Escape closes the Dictionary Entry and puts focus back on the word", async () => {
    const { container } = await renderReader();
    const word = token(container, 0, 0);
    fireEvent.click(word);
    fireEvent.click(await screen.findByRole("button", { name: "Dictionary" }));
    const dialog = await screen.findByTestId("dictionary-window");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("dictionary-window")).toBeNull());
    expect(document.activeElement).toBe(word);
  });
});

describe("Story reader: copying", () => {
  it("a copied paragraph is clean Japanese, without furigana", async () => {
    const { container } = await renderReader();
    const setData = vi.fn();
    const paragraph = container.querySelector('[data-sentence="0"]') as HTMLElement;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    const selection = window.getSelection();
    act(() => {
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    const copy = new Event("copy", { cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: { setData } });
    document.dispatchEvent(copy);
    expect(setData).toHaveBeenCalledWith("text/plain", "がっこうで勉強しました。");
    expect(copy.defaultPrevented).toBe(true);
    selection?.removeAllRanges();
  });
});
