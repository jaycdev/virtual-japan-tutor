import type { ApiClient } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stories } from "./Stories.tsx";

afterEach(cleanup);

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
  pitch: null,
  srsLevel: null,
  mastery: null,
  kanji: [{ literal: "店", known: false, srsLevel: null, mastery: null }],
};

const TE_SHIMAU_POINT = {
  id: 12,
  jlptLevel: "N4",
  catalogueNumber: 30,
  pattern: "～てしまう",
  meaning: "completing something; unfortunately doing",
  variants: ["～ちゃう"],
  explanation: "Use てしまう after the て-form to show an action is completed.",
  explanationEdited: false,
  examples: [
    {
      id: "ex-1",
      sentenceJa: "べんきょうしました",
      translationEn: "I studied.",
      spanStart: 5,
      spanEnd: 9,
      spanText: "しました",
      source: "ai",
    },
  ],
};

/**
 * A stateful fake of the API (issue #10 library/reader settings, plus the
 * issue #11 reading endpoints). `requests` records method, path and body so
 * tests can assert what the screen sent and when — in particular that
 * opening a story is a plain storage read, never a generation.
 */
function fakeApi(opts: { ready?: boolean; blurTranslation?: boolean } = {}) {
  const hasReady = opts.ready ?? true;
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
  const readingSettings = { blurTranslation: opts.blurTranslation ?? true };
  const fetchImpl = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url);
    const body = request.body ? await request.json() : null;
    requests.push({ method: request.method, path: pathname, body });
    if (pathname === "/stories" && request.method === "GET") return json(200, page);
    if (pathname === "/stories/ready" && request.method === "GET") {
      return hasReady ? json(200, storyView) : json(404, { code: "no_ready_story", message: "no story ready" });
    }
    if (pathname === "/stories/st-1" && request.method === "GET") return json(200, storyView);
    if (pathname === "/stories/st-1/rate" && request.method === "POST") return new Response(null, { status: 204 });
    if (pathname === "/stories/st-1/answers" && request.method === "POST")
      return json(200, { correct: true, practiceRecorded: true });
    if (pathname === "/story-settings" && request.method === "GET") return json(200, settings);
    if (pathname === "/story-settings" && request.method === "PUT") {
      Object.assign(settings, body as Partial<typeof settings>);
      return json(200, settings);
    }
    if (pathname === "/reading-settings" && request.method === "GET") return json(200, readingSettings);
    if (pathname === "/reading-settings" && request.method === "PUT") {
      Object.assign(readingSettings, body as Partial<typeof readingSettings>);
      return json(200, readingSettings);
    }
    const entry = pathname.match(/^\/dictionary\/entries\/(\d+)$/)?.[1];
    if (entry === "990101") return json(200, SCHOOL_ENTRY);
    if (entry === "990103") return json(200, MISE_ENTRY);
    if (pathname === "/grammar/points/12" && request.method === "GET") return json(200, TE_SHIMAU_POINT);
    return json(404, { code: "not_found", message: "not found" });
  });
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  return { client, requests };
}

/** Open the ready story (the fastest path into the reader). */
async function openStory(client: ApiClient) {
  render(<Stories client={client} />);
  await screen.findByRole("button", { name: "diary" });
  fireEvent.click(screen.getByRole("button", { name: "Read today's story" }));
  await screen.findByRole("heading", { name: /diary/ });
}

/**
 * The token button for `surface` in the story body. Ruby text (the reading)
 * is part of the button, so match the button whose text starts with the
 * surface rather than by exact accessible name.
 */
function tokenButton(surface: string): HTMLButtonElement {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".story-sentence button.token"));
  const btn = buttons.find((b) => b.textContent?.startsWith(surface));
  if (!btn) throw new Error(`no token button for ${surface}`);
  return btn;
}

describe("Stories screen", () => {
  it("lists the library and opens a story, selecting a sentence on click", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);

    expect(await screen.findByRole("button", { name: "diary" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "diary" }));
    // The Reading Panel only shows a sentence once one is selected —
    // clicking the sentence's text (e.g. its punctuation) selects it.
    await screen.findByLabelText("Reading Panel");
    fireEvent.click(document.querySelector(".story-sentence")!);
    expect(await screen.findByText("I studied at school.")).toBeTruthy();
    // Furigana only where the server's showFurigana says so: がっこう is a
    // solid Known Item (no ruby), べんきょう, しました and いきました carry readings
    // — once in the Reading Panel's copy of the selected sentence, once in the body.
    const rtTexts = Array.from(document.querySelectorAll("ruby rt")).map((rt) => rt.textContent);
    expect(rtTexts).toEqual(["勉強", "しました", "勉強", "しました", "いきました"]);
    // One GET for the library, one for the story settings, one for the
    // opened story and one for the reading settings; nothing else — no
    // generation call.
    await waitFor(() => expect(requests.length).toBe(4));
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /stories",
      "GET /story-settings",
      "GET /stories/st-1",
      "GET /reading-settings",
    ]);
  });

  it("opens the ready story instantly and answers a comprehension question once", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("がっこう")); // also selects the sentence (menu opens)
    const question = screen.getByText("どこで べんきょう しましたか。").closest(".question") as HTMLElement;
    fireEvent.click(within(question).getByRole("button", { name: "がっこう" }));
    expect(await screen.findByText(/Correct/)).toBeTruthy();
    expect(screen.getByText(/practised your focus words/)).toBeTruthy();
    // The question is locked after the single answer.
    expect((within(question).getByRole("button", { name: "いえ" }) as HTMLButtonElement).disabled).toBe(true);

    const answer = requests.find((r) => r.path === "/stories/st-1/answers");
    expect(answer?.body).toEqual({ questionIndex: 0, answerIndex: 0 });
    // Opening came from storage: GET /stories/ready, not any generate endpoint.
    expect(requests.some((r) => r.path === "/stories/ready")).toBe(true);
  });

  it("says when no story is ready", async () => {
    const { client } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    fireEvent.click(screen.getByRole("button", { name: "Read today's story" }));
    expect(await screen.findByText(/No story is ready yet/)).toBeTruthy();
  });

  it("rates a story from the library and marks the button", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    const thumbs = screen.getAllByRole("button", { name: "👍" });
    const thumb = thumbs[0] as HTMLButtonElement;
    fireEvent.click(thumb);
    await waitFor(() => expect(thumb.getAttribute("aria-pressed")).toBe("true"));
    const rate = requests.find((r) => r.path === "/stories/st-1/rate");
    expect(rate?.body).toBe("up");
  });

  it("shows and saves the story settings", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    const threshold = screen.getByLabelText(/Furigana threshold/) as HTMLInputElement;
    const genre = screen.getByLabelText(/Preferred genre/) as HTMLInputElement;
    expect(threshold.value).toBe("3");
    expect(genre.value).toBe("");

    fireEvent.change(threshold, { target: { value: "7" } });
    fireEvent.change(genre, { target: { value: "mystery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Saved — future stories will aim for these/)).toBeTruthy();
    const put = requests.find((r) => r.path === "/story-settings" && r.method === "PUT");
    expect(put?.body).toEqual({ furiganaThresholdSrsLevel: 7, preferredGenre: "mystery", preferredTheme: "" });
    // The fields show what the server stored, not a cleared form.
    await waitFor(() => expect(genre.value).toBe("mystery"));
    expect(threshold.value).toBe("7");
  });

  it("keeps an empty furigana threshold off the wire", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    const threshold = screen.getByLabelText(/Furigana threshold/) as HTMLInputElement;
    // An empty field passes HTML validation (min/max only bound filled
    // values), so this checks the form's own guard before any PUT.
    fireEvent.change(threshold, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/whole number from 1 to 9/)).toBeTruthy();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });
});

describe("Reading Panel", () => {
  it("shows the selected sentence with furigana and a blurred translation", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("がっこう"));
    const panel = screen.getByLabelText("Reading Panel");
    // The sentence with ruby, and the translation blurred by default.
    const ruby = panel.querySelector("ruby rt");
    expect(ruby?.textContent).toBe("勉強");
    const translation = panel.querySelector(".translation") as HTMLElement;
    expect(translation.textContent).toBe("I studied at school.");
    expect(translation.classList.contains("blurred")).toBe(true);
  });

  it("clicking the translation reveals it and remembers the preference", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("がっこう"));
    const panel = screen.getByLabelText("Reading Panel");
    const translation = panel.querySelector(".translation") as HTMLElement;

    fireEvent.click(translation);
    await waitFor(() => expect(panel.querySelector(".translation.blurred")).toBeNull());
    expect(panel.querySelector(".translation.revealed")).toBeTruthy();
    const put = requests.find((r) => r.path === "/reading-settings" && r.method === "PUT");
    expect(put?.body).toEqual({ blurTranslation: false });
  });

  it("starts revealed when the stored preference says so", async () => {
    const { client } = fakeApi({ blurTranslation: false });
    await openStory(client);

    fireEvent.click(tokenButton("がっこう"));
    const panel = screen.getByLabelText("Reading Panel");
    await waitFor(() => expect(panel.querySelector(".translation.revealed")).toBeTruthy());
    expect(panel.querySelector(".translation.blurred")).toBeNull();
  });

  it("selects a sentence when punctuation (not a token) is clicked", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(document.querySelectorAll(".story-sentence")[1] as HTMLElement);
    const panel = screen.getByLabelText("Reading Panel");
    expect(await screen.findByText("I went to the shop.")).toBeTruthy();
    expect(panel.querySelector(".translation")?.textContent).toBe("I went to the shop.");
  });
});

describe("Lookup row", () => {
  it("fills instantly on hover with word, reading, glosses, pitch and JLPT — and clears on hover-out", async () => {
    const { client } = fakeApi();
    await openStory(client);

    const word = tokenButton("がっこう");
    fireEvent.mouseEnter(word);
    // The Focus Set gloss is on the row right away, before any fetch lands.
    expect(document.querySelector(".lookup-word")?.textContent).toBe("がっこう");
    expect(document.querySelector(".lookup-glosses")?.textContent).toContain("school");

    // Once the cached entry arrives, the full Lookup row line is up.
    await waitFor(() => expect(document.querySelector(".pitch-graph")).toBeTruthy());
    // A kana word whose reading matches its surface gets no separate orange reading…
    expect(document.querySelector(".lookup-reading")).toBeNull();
    expect(document.querySelector(".jlpt-badge")?.textContent).toBe("N5");
    // Two glosses, with "…" for the entry's third.
    expect(document.querySelector(".lookup-glosses")?.textContent).toBe("school, colloquial reading…");

    // …while a kanji word shows its kana reading in orange.
    fireEvent.mouseLeave(word);
    fireEvent.mouseEnter(tokenButton("べんきょう"));
    expect(document.querySelector(".lookup-word")?.textContent).toBe("べんきょう");
    expect(document.querySelector(".lookup-reading")?.textContent).toBe("勉強");

    fireEvent.mouseLeave(tokenButton("べんきょう"));
    expect(document.querySelector(".lookup-word")).toBeNull();
    expect(screen.getByText(/Hover or Tab to a word/)).toBeTruthy();
  });

  it("keyboard focus drives the same Lookup row", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.focus(tokenButton("で"));
    await waitFor(() => expect(document.querySelector(".lookup-word")?.textContent).toBe("で"));
    // で has no dictionary row in this fake, so no JLPT badge or pitch shows.
    expect(document.querySelector(".jlpt-badge")).toBeNull();
    fireEvent.blur(tokenButton("で"));
    expect(document.querySelector(".lookup-word")).toBeNull();
  });

  it("hovering a Grammar Span shows the Grammar Point instead, without any request", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.mouseEnter(tokenButton("しました"));
    expect(document.querySelector(".lookup-word")?.textContent).toBe("～てしまう");
    expect(document.querySelector(".lookup-glosses")?.textContent).toBe("completing something; unfortunately doing");
    expect(document.querySelector(".jlpt-badge")?.textContent).toBe("N4");
    expect(requests.some((r) => r.path.startsWith("/dictionary/entries/"))).toBe(false);
    expect(requests.some((r) => r.path.startsWith("/grammar/points/"))).toBe(false);
  });
});

describe("Word menu and windows", () => {
  it("clicking a word opens the menu; Save items wait for issue #12", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("がっこう"));
    const menu = screen.getByRole("menu");
    expect((within(menu).getByRole("menuitem", { name: "Dictionary" }) as HTMLButtonElement).disabled).toBe(false);
    for (const name of ["Save", "Save to…"]) {
      const item = within(menu).getByRole("menuitem", { name }) as HTMLButtonElement;
      expect(item.disabled).toBe(true);
      expect(item.title).toContain("issue #12");
    }
  });

  it("Dictionary opens a window with senses, SRS state, kanji and pitch", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("がっこう"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dictionary" }));
    const win = await screen.findByLabelText("Dictionary entry: がっこう");
    expect(within(win).getByText("school")).toBeTruthy();
    expect(within(win).getByText(/noun/)).toBeTruthy();
    expect(within(win).getByText(/Known item — SRS Level 4, Mastery 44%/)).toBeTruthy();
    // Kanji breakdown with the Learner's state for each.
    expect(within(win).getByText("学")).toBeTruthy();
    expect(within(win).getByText("known")).toBeTruthy();
    expect(within(win).getByText("校")).toBeTruthy();
    expect(within(win).getByText("new")).toBeTruthy();
    expect(win.querySelector(".pitch-graph")).toBeTruthy();

    // Escape closes all windows.
    fireEvent.keyDown(tokenButton("がっこう"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Dictionary entry: がっこう")).toBeNull());
  });

  it("clicking a Grammar Span opens the Grammar Point window with explanation and examples", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("しました"));
    const win = await screen.findByLabelText("Grammar point 12");
    expect(await within(win).findByText(/action is completed/)).toBeTruthy();
    const mark = win.querySelector("mark");
    expect(mark?.textContent).toBe("しました");
    expect(requests.some((r) => r.path === "/grammar/points/12" && r.method === "GET")).toBe(true);
  });

  it("the Dictionary item is disabled for a token with no dictionary link", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("に"));
    const menu = screen.getByRole("menu");
    expect((within(menu).getByRole("menuitem", { name: "Dictionary" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("Token underlines", () => {
  it("solid for Known Items, dotted for unknown linked words, wavy for grammar", async () => {
    const { client } = fakeApi();
    await openStory(client);

    expect(document.querySelector(".tok-known")?.textContent).toBe("がっこう");
    expect(document.querySelector(".tok-dotted")?.textContent).toBe("で");
    // べんきょう is unknown and unlinked → no underline. (Ruby text counts
    // in textContent, so match the surface at the start.)
    expect(document.querySelector(".tok-plain")?.textContent).toMatch(/^べんきょう/);
    // しました sits in the story's focus Grammar Span → wavy + bold, overriding its token rule.
    const grammar = document.querySelector(".tok-grammar");
    expect(grammar?.textContent).toMatch(/^しました/);
    expect(grammar?.classList.contains("tok-grammar-focus")).toBe(true);
  });
});
