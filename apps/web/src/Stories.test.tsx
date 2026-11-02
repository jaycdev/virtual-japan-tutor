import { readFileSync } from "node:fs";
import type { ApiClient } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  pitch: { reading: "みせ", moraCount: 2, accentPosition: 0, heiban: true, downstepAfterMora: null },
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

const IKU_POINT = {
  id: 13,
  jlptLevel: "N5",
  catalogueNumber: 5,
  pattern: "～に行く",
  meaning: "going to (a place)",
  variants: [],
  explanation: "に行く marks movement toward a destination.",
  explanationEdited: false,
  examples: [],
};

/**
 * A stateful fake of the API (issue #10 library/reader settings, plus the
 * issue #11 reading endpoints). `requests` records method, path and body so
 * tests can assert what the screen sent and when — in particular that
 * opening a story is a plain storage read, never a generation.
 */
function fakeApi(
  opts: {
    /** Whether an Automatic Story exists for the Today panel (issue #32). */
    automatic?: boolean;
    blurTranslation?: boolean;
    extraSpan?: boolean;
    /** Hold every fetch of this entSeq until releaseEntries() is called. */
    gateEntry?: number;
    /** Fail PUT /reading-settings, as a server error would. */
    failReadingPut?: boolean;
    /** Lookup-hold threshold the fake reading settings carry. */
    lookupHoldMs?: number;
    /** Story Origin as stored (issue #31); defaults to generator-produced. */
    origin?: "automatic" | "on_demand";
    /** Creation stamp of the fake story (for the Today panel's day wording). */
    createdAt?: string;
    /** Pre-set Read mark on the fake story. */
    readAt?: string;
  } = {},
) {
  const hasAutomatic = opts.automatic ?? true;
  const storyView = {
    id: "st-1",
    genre: "diary",
    title: "My diary",
    titleEn: "My diary in English",
    theme: "school life",
    origin: opts.origin ?? "automatic",
    readAt: opts.readAt ?? (null as string | null),
    text: "がっこうでべんきょうしました。",
    createdAt: opts.createdAt ?? "2026-11-01T09:00:00Z",
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
        // Widened to cover みせ + に + いきました, so span-hover tests can
        // check that every token of the span lights up, not just one.
        grammarSpans: opts.extraSpan
          ? [
              {
                start: 0,
                end: 7,
                grammarPointId: "13",
                isFocus: false,
                pattern: "～に行く",
                meaning: "going to (a place)",
                jlptLevel: "N5",
              },
            ]
          : [],
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
  const gated: (() => void)[] = [];
  const settings = { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "", timezone: "" };
  const readingSettings = { blurTranslation: opts.blurTranslation ?? true, lookupHoldMs: opts.lookupHoldMs ?? 800 };

  // Item Lists (issue #12): a Saved default and one plain list, with just
  // enough server behaviour — duplicate names, default tracking — for the
  // Save flow and its inline create to be tested honestly.
  const itemLists = [
    { id: "l1", name: "Saved", boosting: true, isDefault: true, itemCount: 1 },
    { id: "l2", name: "Travel", boosting: false, isDefault: false, itemCount: 3 },
  ];
  let defaultListId = "l1";
  const markDefault = () => {
    for (const l of itemLists) l.isDefault = l.id === defaultListId;
  };

  const fetchImpl = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url);
    const body = request.body ? await request.json() : null;
    requests.push({ method: request.method, path: pathname, body });
    if (pathname === "/stories" && request.method === "GET") return json(200, page);
    // Today's Story (issue #32): the newest Automatic Story, or 404 no_story.
    // An On-demand story is never Today's Story, even when it is the newest.
    if (pathname === "/stories/today" && request.method === "GET") {
      const show = hasAutomatic && storyView.origin !== "on_demand";
      return show
        ? json(200, { ...storyView, hasAutomatic: true })
        : json(404, { code: "no_story", message: "no automatic story yet" });
    }
    if (pathname === "/stories/st-1" && request.method === "GET") return json(200, storyView);
    if (pathname === "/stories/st-1/rate" && request.method === "POST") return new Response(null, { status: 204 });
    // Story library (issue #31): the Read mark and Delete. The fake keeps
    // readAt on the story so a later read shows the new state, and dropping
    // the story removes it from the page as a real store would.
    if (pathname === "/stories/st-1/read" && request.method === "PUT") {
      storyView.readAt = "2026-11-02T10:00:00Z";
      return new Response(null, { status: 204 });
    }
    if (pathname === "/stories/st-1/read" && request.method === "DELETE") {
      storyView.readAt = null;
      return new Response(null, { status: 204 });
    }
    if (pathname === "/stories/st-1" && request.method === "DELETE") {
      page.items = page.items.filter((s) => s.id !== "st-1");
      page.total = page.items.length;
      return new Response(null, { status: 204 });
    }
    if (pathname === "/stories/st-1/answers" && request.method === "POST")
      return json(200, { correct: true, practiceRecorded: true });
    if (pathname === "/story-settings" && request.method === "GET") return json(200, settings);
    if (pathname === "/story-settings" && request.method === "PUT") {
      Object.assign(settings, body as Partial<typeof settings>);
      return json(200, settings);
    }
    if (pathname === "/reading-settings" && request.method === "GET") return json(200, readingSettings);
    if (pathname === "/reading-settings" && request.method === "PUT") {
      if (opts.failReadingPut) return json(500, { code: "internal", message: "server exploded" });
      Object.assign(readingSettings, body as Partial<typeof readingSettings>);
      return json(200, readingSettings);
    }
    const entry = pathname.match(/^\/dictionary\/entries\/(\d+)$/)?.[1];
    if (entry && opts.gateEntry && entry === String(opts.gateEntry)) {
      return new Promise<Response>((resolve) => {
        gated.push(() => resolve(json(200, entry === "990101" ? SCHOOL_ENTRY : MISE_ENTRY)));
      });
    }
    if (entry === "990101") return json(200, SCHOOL_ENTRY);
    if (entry === "990103") return json(200, MISE_ENTRY);
    if (pathname === "/grammar/points/12" && request.method === "GET") return json(200, TE_SHIMAU_POINT);
    if (pathname === "/grammar/points/13" && request.method === "GET") return json(200, IKU_POINT);

    // Item Lists and Weak Signals (issue #12).
    if (pathname === "/item-lists" && request.method === "GET") {
      markDefault();
      return json(200, { items: itemLists, defaultListId });
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
    if (pathname === "/item-lists/default" && request.method === "PUT") {
      const id = String((body as { listId?: string }).listId ?? "");
      if (!itemLists.some((l) => l.id === id)) return json(404, { code: "not_found", message: "no such list" });
      defaultListId = id;
      markDefault();
      return new Response(null, { status: 204 });
    }
    const listMatch = pathname.match(/^\/item-lists\/([^/]+)(\/items)?$/);
    if (listMatch && itemLists.some((l) => l.id === listMatch[1])) {
      const list = itemLists.find((l) => l.id === listMatch[1])!;
      if (listMatch[2]) {
        if (request.method === "POST") {
          list.itemCount += 1;
          return new Response(null, { status: 204 });
        }
        if (request.method === "DELETE") return new Response(null, { status: 204 });
      } else if (request.method === "PUT") {
        const patch = body as { name?: string; boosting?: boolean };
        if (patch.name !== undefined) list.name = patch.name;
        if (patch.boosting !== undefined) list.boosting = patch.boosting;
        return json(200, list);
      } else if (request.method === "DELETE") {
        if (list.name.toLowerCase() === "saved") {
          return json(400, { code: "bad_request", message: "The Saved list cannot be deleted." });
        }
        itemLists.splice(itemLists.indexOf(list), 1);
        return new Response(null, { status: 204 });
      }
    }
    if (pathname === "/weak-signals" && request.method === "POST") return new Response(null, { status: 204 });

    return json(404, { code: "not_found", message: "not found" });
  });
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  return {
    client,
    requests,
    itemLists,
    /** Answer the oldest held dictionary fetch; later ones can arrive after
     *  the UI has already moved on — which is exactly the race. */
    releaseEntry: () => gated.shift()?.(),
  };
}

/** Open today's story (the fastest path into the reader), via the landing
 *  view the Stories page now opens on. */
async function openStory(client: ApiClient) {
  render(<Stories client={client} />);
  fireEvent.click(await screen.findByRole("button", { name: "Read today’s story" }));
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
  it("lands on Today’s Story, opens the library on demand, and selects a sentence on click", async () => {
    const { client, requests } = fakeApi();
    render(<Stories client={client} />);

    // The landing view is Today's Story, not the Story Library table.
    expect(await screen.findByRole("button", { name: "Read today’s story" })).toBeTruthy();
    expect(screen.queryByTestId("story-st-1")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View all stories" }));
    await screen.findByTestId("story-st-1");

    fireEvent.click(screen.getByRole("button", { name: "My diary" }));
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
    // Mount: the library page, Today's Story and the story settings. Opening
    // a row adds the story itself, the reading settings and the Item Lists the
    // reader's Save flow needs; nothing else — no generation call.
    await waitFor(() => expect(requests.length).toBe(6));
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /stories",
      "GET /stories/today",
      "GET /story-settings",
      "GET /stories/st-1",
      "GET /reading-settings",
      "GET /item-lists",
    ]);
  });

  it("opens today’s story instantly and answers a comprehension question once", async () => {
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
    // Today came from storage: GET /stories/today, not any generate endpoint.
    expect(requests.some((r) => r.path === "/stories/today")).toBe(true);
  });

  it("says when there is no story yet, and Check again re-asks", async () => {
    const { client, requests } = fakeApi({ automatic: false });
    render(<Stories client={client} />);

    expect(await screen.findByText(/No story yet/)).toBeTruthy();
    // The Story Library stays one click away even with nothing to read.
    expect(screen.getByRole("button", { name: "View all stories" })).toBeTruthy();
    const before = requests.filter((r) => r.path === "/stories/today").length;
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(requests.filter((r) => r.path === "/stories/today").length).toBe(before + 1),
    );
  });

  it("words the day the Automatic Story belongs to", async () => {
    const { client } = fakeApi({ createdAt: new Date(Date.now() - 60_000).toISOString() });
    render(<Stories client={client} />);
    expect(await screen.findByText("Written for you today.")).toBeTruthy();
  });

  it("labels an unread story from an earlier local day by weekday", async () => {
    const created = new Date();
    created.setDate(created.getDate() - 2); // two local days back, so not today
    created.setHours(9, 0, 0, 0);
    const weekday = created.toLocaleDateString(undefined, { weekday: "long" });
    const { client } = fakeApi({ createdAt: created.toISOString() });
    render(<Stories client={client} />);
    expect(await screen.findByText(new RegExp(`Still unread from ${weekday}`))).toBeTruthy();
  });

  it("shows Read again once today's story has been read", async () => {
    const { client } = fakeApi({ readAt: new Date().toISOString() });
    render(<Stories client={client} />);
    expect(await screen.findByText("You read it today.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Read today’s story again" })).toBeTruthy();
  });

  it("rates a story from the reader and marks the button", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    const thumb = screen.getByRole("button", { name: "👍" }) as HTMLButtonElement;
    fireEvent.click(thumb);
    await waitFor(() => expect(thumb.getAttribute("aria-pressed")).toBe("true"));
    const rate = requests.find((r) => r.path === "/stories/st-1/rate");
    expect(rate?.body).toBe("up");
  });

  it("shows and saves the story settings", async () => {
    const { client, requests } = fakeApi({ automatic: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "Save settings" });

    const threshold = screen.getByLabelText(/Furigana threshold/) as HTMLInputElement;
    const genre = screen.getByLabelText(/Preferred genre/) as HTMLInputElement;
    expect(threshold.value).toBe("3");
    expect(genre.value).toBe("");

    fireEvent.change(threshold, { target: { value: "7" } });
    fireEvent.change(genre, { target: { value: "mystery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Saved — future stories will aim for these/)).toBeTruthy();
    const put = requests.find((r) => r.path === "/story-settings" && r.method === "PUT");
    expect(put?.body).toEqual({
      furiganaThresholdSrsLevel: 7,
      preferredGenre: "mystery",
      preferredTheme: "",
      timezone: "",
    });
    // The fields show what the server stored, not a cleared form.
    await waitFor(() => expect(genre.value).toBe("mystery"));
    expect(threshold.value).toBe("7");
  });

  it("saves the Learner’s Timezone and shows what was stored", async () => {
    const { client, requests } = fakeApi();
    render(<Stories client={client} />);

    await screen.findByRole("button", { name: "Save settings" });
    const tz = screen.getByLabelText(/Your timezone/) as HTMLInputElement;
    expect(tz.value).toBe("");
    fireEvent.change(tz, { target: { value: "Asia/Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Saved/)).toBeTruthy();
    const put = requests.find((r) => r.path === "/story-settings" && r.method === "PUT");
    expect(put?.body).toMatchObject({ timezone: "Asia/Tokyo" });
    await waitFor(() => expect(tz.value).toBe("Asia/Tokyo"));
  });

  it("suggests the browser’s timezone and autocompletes from a curated list", async () => {
    const { client } = fakeApi();
    const spy = vi
      .spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions")
      .mockReturnValue({ timeZone: "America/Los_Angeles" } as ReturnType<
        Intl.DateTimeFormat["resolvedOptions"]
      >);
    try {
      render(<Stories client={client} />);
      await screen.findByRole("button", { name: "Use my browser's timezone" });
      fireEvent.click(screen.getByRole("button", { name: "Use my browser's timezone" }));
      const tz = screen.getByLabelText(/Your timezone/) as HTMLInputElement;
      expect(tz.value).toBe("America/Los_Angeles");
      // The free text stays free (the server validates), but common zones are offered.
      const list = document.getElementById(String(tz.getAttribute("list")));
      expect(list?.querySelector('option[value="Asia/Tokyo"]')).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps an empty furigana threshold off the wire", async () => {
    const { client, requests } = fakeApi({ automatic: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "Save settings" });

    const threshold = screen.getByLabelText(/Furigana threshold/) as HTMLInputElement;
    // An empty field passes HTML validation (min/max only bound filled
    // values), so this checks the form's own guard before any PUT.
    fireEvent.change(threshold, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/whole number from 1 to 9/)).toBeTruthy();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });
});

describe("Story library (issue #31)", () => {
  it("shows title, theme, origin and created in a table, without rating controls", async () => {
    const { client } = fakeApi({ automatic: false });
    render(<Stories client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "View all stories" }));
    const row = await screen.findByTestId("story-st-1");

    for (const name of ["Title", "Genre", "Theme", "Origin", "Created", "Read"])
      expect(screen.getByRole("columnheader", { name })).toBeTruthy();
    expect(within(row).getByText("My diary")).toBeTruthy();
    expect(within(row).getByText("school life")).toBeTruthy();
    expect(within(row).getByText("Automatic")).toBeTruthy();
    // Ratings are not part of this table any more.
    expect(within(row).queryByRole("button", { name: "👍" })).toBeNull();
  });

  it("labels the origin of an on-demand story", async () => {
    const { client } = fakeApi({ automatic: false, origin: "on_demand" });
    render(<Stories client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "View all stories" }));
    const row = await screen.findByTestId("story-st-1");
    expect(within(row).getByText("On demand")).toBeTruthy();
    expect(within(row).queryByText("Automatic")).toBeNull();
  });

  it("blurs the title translation until clicked, saving nothing and signalling nothing", async () => {
    const { client, requests } = fakeApi({ automatic: false });
    render(<Stories client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "View all stories" }));
    const row = await screen.findByTestId("story-st-1");

    const en = within(row).getByRole("button", { name: /My diary in English/ });
    expect(en.className).toContain("blurred");
    fireEvent.click(en);
    await waitFor(() => expect(en.className).toContain("revealed"));
    // A transient reveal: no settings PUT, no Weak Signal POST.
    expect(requests.some((r) => r.method === "PUT" || r.method === "POST")).toBe(false);
  });

  it("marks a story Read from the table and clears it again", async () => {
    const { client, requests } = fakeApi({ automatic: false });
    render(<Stories client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "View all stories" }));
    const row = await screen.findByTestId("story-st-1");

    const read = within(row).getByRole("button", { name: "Read" });
    expect(read.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(read);
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: "Read" }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect(requests.some((r) => r.method === "PUT" && r.path === "/stories/st-1/read")).toBe(true);

    fireEvent.click(within(row).getByRole("button", { name: "Read" }));
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: "Read" }).getAttribute("aria-pressed")).toBe("false"),
    );
    expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1/read")).toBe(true);
  });

  it("deletes a story behind a confirmation and drops the row", async () => {
    const { client, requests } = fakeApi({ automatic: false });
    render(<Stories client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "View all stories" }));
    await screen.findByTestId("story-st-1");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    // Asking is not deleting: nothing sent, the row is still there.
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    expect(screen.getByTestId("story-st-1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(screen.queryByTestId("story-st-1")).toBeNull());
    expect(requests.some((r) => r.method === "DELETE" && r.path === "/stories/st-1")).toBe(true);
  });

  it("an On-demand story is never Today’s Story, though the library lists it", async () => {
    const { client } = fakeApi({ origin: "on_demand" });
    render(<Stories client={client} />);
    expect(await screen.findByText(/No story yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View all stories" }));
    expect(await screen.findByTestId("story-st-1")).toBeTruthy();
  });

  it("shows the title with a blurred translation and a Read toggle in the reader", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    const heading = screen.getByRole("heading", { name: /diary/ });
    expect(heading.textContent).toContain("My diary");
    const en = within(heading).getByRole("button", { name: /My diary in English/ });
    expect(en.className).toContain("blurred");
    fireEvent.click(en);
    await waitFor(() => expect(en.className).toContain("revealed"));

    const read = screen.getByRole("button", { name: "Read" });
    expect(read.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(read);
    await waitFor(() => expect(screen.getByRole("button", { name: "Read" }).getAttribute("aria-pressed")).toBe("true"));
    expect(requests.some((r) => r.method === "PUT" && r.path === "/stories/st-1/read")).toBe(true);
  });

  it("the reader’s Back returns to the Today panel when opened from there", async () => {
    const { client } = fakeApi();
    await openStory(client);
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(await screen.findByRole("button", { name: "Read today’s story" })).toBeTruthy();
    expect(screen.queryByTestId("story-st-1")).toBeNull();
  });

  it("the reader’s Back returns to the library when opened from a row", async () => {
    const { client } = fakeApi();
    render(<Stories client={client} />);
    fireEvent.click(await screen.findByRole("button", { name: "View all stories" }));
    const row = await screen.findByTestId("story-st-1");
    fireEvent.click(within(row).getByRole("button", { name: "My diary" }));
    await screen.findByRole("heading", { name: /diary/ });
    fireEvent.click(screen.getByRole("button", { name: "← Back" }));
    expect(await screen.findByTestId("story-st-1")).toBeTruthy();
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
    // The whole settings object goes over the wire, so the hold threshold
    // rides along unchanged with the blur flip.
    expect(put?.body).toEqual({ blurTranslation: false, lookupHoldMs: 800 });
  });

  it("says so when saving the blur preference fails, and keeps the old state", async () => {
    const { client } = fakeApi({ failReadingPut: true });
    await openStory(client);

    fireEvent.click(tokenButton("がっこう"));
    const panel = screen.getByLabelText("Reading Panel");
    fireEvent.click(panel.querySelector(".translation") as HTMLElement);

    // The failure is shown, not swallowed — and nothing half-applied: the
    // stored preference still stands, so the translation stays blurred.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("server exploded");
    expect(panel.querySelector(".translation.blurred")).toBeTruthy();
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

  it("shrinks an overflowing sentence once, and never un-shrinks on a later re-render", async () => {
    // jsdom has no layout engine, so fake one that fits after the shrink:
    // 400px of content unshrunk, 40px shrunk, box 60px. A component that
    // re-measures on every render (the old bug) would add `.shrunk`, see it
    // fit, strip it on the next render, and flap the text size on every hover.
    const sh = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight");
    const ch = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains("shrunk") ? 40 : 400;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 60 });
    try {
      const { client } = fakeApi();
      await openStory(client);
      fireEvent.click(tokenButton("がっこう"));
      const area = document.querySelector(".sentence-area") as HTMLElement;
      await waitFor(() => expect(area.classList.contains("shrunk")).toBe(true));

      // Hovers re-render the panel with `.shrunk` still on the box — the
      // measuring ref must not take the shrink back off.
      fireEvent.mouseEnter(tokenButton("べんきょう"));
      fireEvent.mouseLeave(tokenButton("べんきょう"));
      expect(area.classList.contains("shrunk")).toBe(true);

      // The shrink styles an inner wrapper, so the box's own em height is
      // untouched and the panel stays exactly as big.
      expect(area.querySelector(".sentence-content")).toBeTruthy();
    } finally {
      if (sh) Object.defineProperty(HTMLElement.prototype, "scrollHeight", sh);
      else Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
      if (ch) Object.defineProperty(HTMLElement.prototype, "clientHeight", ch);
      else Reflect.deleteProperty(HTMLElement.prototype, "clientHeight");
    }
  });

  it("the panel's box is fixed in CSS: two-line height, then scroll — never resize", () => {
    // vitest cwd = apps/web; comments stripped so "font-size" inside prose
    // cannot skew the structural assertions below.
    const css = readFileSync("src/reader.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const panel = css.match(/\.reading-panel \{[^}]*\}/)?.[0] ?? "";
    expect(panel).toMatch(/height: 7\.5em/);
    const area = css.match(/\.reading-panel \.sentence-area \{[^}]*\}/)?.[0] ?? "";
    expect(area).toMatch(/height: 4\.4em/); // fixed two-line height, ruby included
    expect(area).not.toMatch(/max-height/);
    expect(area).not.toMatch(/font-size/); // the box's em base never moves
    expect(area).toMatch(/overflow-y: auto/);
    // The shrink sits on an inner wrapper: a font-size on the box itself would
    // shrink its own 4.4em height and resize the panel.
    expect(css).toMatch(/\.sentence-area\.shrunk \.sentence-content \{[^}]*font-size: 0\.8em/);
    expect(css).not.toMatch(/\.sentence-area\.shrunk \{[^}]*font-size/);
    expect(css).toMatch(/\.lookup-label \{[^}]*flex: 0 0 6\.4em/);
    // Grammar Spans read differently from the known/unknown underlines.
    expect(css).toMatch(/\.tok-grammar \{[^}]*underline wavy #7c3aed/);
    expect(css).toMatch(/\.tok-grammar-focus \{[^}]*text-decoration-thickness/);
    expect(css).toMatch(/\.tok-dotted \{[^}]*underline dotted/);
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

  it("keeps a fixed 'Word meaning' label leading the row", async () => {
    const { client } = fakeApi();
    await openStory(client);

    const row = document.querySelector(".lookup-row") as HTMLElement;
    // Present before any lookup, and still first once one fills the row —
    // the slot is fixed, so the row never shifts.
    expect(row.querySelector(".lookup-label")?.textContent).toBe("Word meaning");
    expect(row.firstElementChild?.className).toBe("lookup-label");

    fireEvent.mouseEnter(tokenButton("がっこう"));
    expect(document.querySelector(".lookup-word")?.textContent).toBe("がっこう");
    expect(row.querySelector(".lookup-label")?.textContent).toBe("Word meaning");
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

  it("hovering a Grammar Span token lights up every token the span covers", async () => {
    const { client } = fakeApi({ extraSpan: true }); // ～に行く covers みせ・に・いきました
    await openStory(client);

    fireEvent.mouseEnter(tokenButton("に"));
    const lit = Array.from(document.querySelectorAll(".story-sentence button.token.is-hovered")).map(
      (b) => b.textContent ?? "",
    );
    // Hovering one token of the span highlights the whole span, not just it.
    expect(lit.some((t) => t.startsWith("みせ"))).toBe(true);
    expect(lit.some((t) => t.startsWith("に"))).toBe(true);
    expect(lit.some((t) => t.startsWith("いきました"))).toBe(true);
    // Tokens outside the second sentence's span stay dark.
    expect(lit.some((t) => t.startsWith("がっこう"))).toBe(false);
  });

  it("does not re-ask the dictionary for a lookup that already failed", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    const de = tokenButton("で"); // entSeq 990102: the fake has no entry for it
    fireEvent.mouseEnter(de);
    const looked = () => requests.filter((r) => r.path === "/dictionary/entries/990102").length;
    await waitFor(() => expect(looked()).toBe(1));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0)); // let the failure settle and cache
    });

    fireEvent.mouseLeave(de);
    fireEvent.mouseEnter(de);
    // The failure is remembered: a second hover costs no second request.
    expect(looked()).toBe(1);
  });
});

describe("Pitch graph", () => {
  it("draws a filled dot per mora and a hollow dot for the particle — heiban keeps it high", async () => {
    const { client } = fakeApi();
    await openStory(client);

    // みせ is heiban in the fake: 2 moras, no downstep.
    fireEvent.mouseEnter(tokenButton("みせ"));
    await waitFor(() => expect(document.querySelector(".pitch-graph")).toBeTruthy());
    const graph = document.querySelector(".pitch-graph") as Element;
    const moras = graph.querySelectorAll(".pitch-mora");
    expect(moras.length).toBe(2);
    expect(moras[0]?.getAttribute("fill")).toBe("#1a56db"); // filled
    const particle = graph.querySelector(".pitch-particle") as Element;
    expect(particle.getAttribute("fill")).toBe("#fff"); // hollow, stroked
    // Heiban: mora 1 low (y=15), mora 2 AND the following particle high (y=3).
    expect(moras[0]?.getAttribute("cy")).toBe("15");
    expect(moras[1]?.getAttribute("cy")).toBe("3");
    expect(particle.getAttribute("cy")).toBe("3");
    // The joining line runs through every dot, particle included.
    const points = (graph.querySelector("polyline") as Element).getAttribute("points")?.trim().split(/\s+/);
    expect(points?.length).toBe(3);
  });

  it("the particle dot drops low after a downstep", async () => {
    const { client } = fakeApi();
    await openStory(client);

    // がっこう: 4 moras, downstep after mora 3.
    fireEvent.mouseEnter(tokenButton("がっこう"));
    await waitFor(() => expect(document.querySelector(".pitch-graph")).toBeTruthy());
    const graph = document.querySelector(".pitch-graph") as Element;
    expect(graph.querySelectorAll(".pitch-mora").length).toBe(4);
    const dots = Array.from(graph.querySelectorAll(".pitch-mora"));
    expect(dots.map((d) => d.getAttribute("cy"))).toEqual(["3", "3", "3", "15"]);
    expect(graph.querySelector(".pitch-particle")?.getAttribute("cy")).toBe("15");
  });
});

describe("Word menu and windows", () => {
  it("clicking a word opens the menu, and Save enables once the Item Lists load", async () => {
    const { client } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("がっこう"));
    const menu = screen.getByRole("menu");
    expect((within(menu).getByRole("menuitem", { name: "Dictionary" }) as HTMLButtonElement).disabled).toBe(false);
    // The lists load in the background: Save turns on as soon as they are
    // known, and its title names the Default List it targets.
    const save = within(menu).getByRole("menuitem", { name: "Save" }) as HTMLButtonElement;
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(save.title).toBe("Save to Saved");
    expect((within(menu).getByRole("menuitem", { name: "Save to…" }) as HTMLButtonElement).disabled).toBe(false);
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

    // Escape closes the open window (one press peels one layer).
    fireEvent.keyDown(tokenButton("がっこう"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Dictionary entry: がっこう")).toBeNull());
  });

  it("the window shows the entry when the hover's fetch lands after the window opened", async () => {
    const { client, releaseEntry } = fakeApi({ gateEntry: 990101 });
    await openStory(client);

    // Hover starts the lookup request; it is held open.
    fireEvent.mouseEnter(tokenButton("がっこう"));
    // Click opens the menu and Dictionary opens the window — nothing has
    // arrived, so the window starts its own request too (also held).
    fireEvent.click(tokenButton("がっこう"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Dictionary" }));
    const win = await screen.findByLabelText("Dictionary entry: がっこう");
    expect(within(win).getByText("Loading entry…")).toBeTruthy();

    // The hover's response lands first: the cache fills, the window sees the
    // cached entry, and its own request becomes the stale duplicate.
    releaseEntry();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // The window's own (now-duplicate) response lands — it must not put the
    // window back on "Loading…" or leave it there.
    releaseEntry();
    await waitFor(() => expect(within(win).queryByText("Loading entry…")).toBeNull());
    expect(within(win).getByText(/Known item — SRS Level 4, Mastery 44%/)).toBeTruthy();
  });

  it("a window opening from the menu keeps focus on the token, and closing returns it", async () => {
    const { client } = fakeApi();
    await openStory(client);

    const word = tokenButton("みせ");
    fireEvent.click(word); // menu opens (focus moves into it)
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Dictionary" }));
    const win = await screen.findByLabelText("Dictionary entry: みせ");
    // The menu closed to open the window: focus went back to the token, not body.
    expect(document.activeElement).toBe(word);

    fireEvent.click(within(win).getByRole("button", { name: "Close entry window" }));
    await waitFor(() => expect(screen.queryByLabelText("Dictionary entry: みせ")).toBeNull());
    // And closing the window hands focus back to the same token.
    expect(document.activeElement).toBe(word);
  });

  it("clicking a Grammar Span token opens the menu; Grammar opens the point window", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("しました"));
    // The spec's menu sits over any tapped token — span tokens included.
    const menu = screen.getByRole("menu");
    // しました itself has no dictionary link, so its Dictionary item is disabled…
    expect((within(menu).getByRole("menuitem", { name: "Dictionary" }) as HTMLButtonElement).disabled).toBe(true);
    // …while Grammar carries the span's full entry.
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Grammar" }));
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

  it("a word inside a Grammar Span still reaches its own Dictionary Entry", async () => {
    const { client } = fakeApi({ extraSpan: true });
    await openStory(client);

    // みせ now sits inside a Grammar Span…
    expect(tokenButton("みせ").classList.contains("tok-grammar")).toBe(true);
    // …but clicking it opens the same menu, with the word's Dictionary and
    // the span's Grammar side by side.
    fireEvent.click(tokenButton("みせ"));
    const menu = screen.getByRole("menu");
    expect((within(menu).getByRole("menuitem", { name: "Dictionary" }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(menu).getByRole("menuitem", { name: "Grammar" })).toBeTruthy();

    fireEvent.click(within(menu).getByRole("menuitem", { name: "Dictionary" }));
    const win = await screen.findByLabelText("Dictionary entry: みせ");
    expect(within(win).getByText(/shop; store/)).toBeTruthy();
  });

  it("Enter opens the menu focused on its first item; Escape closes just the menu", async () => {
    const { client } = fakeApi();
    await openStory(client);

    // Open a Dictionary Entry window first, to show Escape leaves it alone.
    fireEvent.click(tokenButton("みせ"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Dictionary" }));
    await screen.findByLabelText("Dictionary entry: みせ");

    // Keyboard: Tab to the token, Enter opens the same menu a click gives…
    const word = tokenButton("がっこう");
    word.focus();
    fireEvent.keyDown(word, { key: "Enter" });
    fireEvent.click(word); // a browser fires click for Enter on a button
    const menu = await screen.findByRole("menu");
    // …and focus moves into the menu, onto the first enabled item.
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Dictionary"));
    expect(menu.contains(document.activeElement)).toBe(true);

    // Escape closes only the menu and hands focus back to the token.
    fireEvent.keyDown(document.activeElement as Element, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(document.activeElement).toBe(word);
    expect(screen.getByLabelText("Dictionary entry: みせ")).toBeTruthy();

    // A second Escape closes the window.
    fireEvent.keyDown(word, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Dictionary entry: みせ")).toBeNull());
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

describe("Saving and Weak Signals (issue #12)", () => {
  /** The named menu item, once the Item Lists have loaded and it is clickable. */
  async function enabledItem(name: string): Promise<HTMLButtonElement> {
    return waitFor(() => {
      const b = within(screen.getByRole("menu")).getByRole("menuitem", { name }) as HTMLButtonElement;
      if (b.disabled) throw new Error(`${name} still disabled`);
      return b;
    });
  }

  it("Save puts the word in the Default List, closes the menu and refocuses the token", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    const word = tokenButton("がっこう");
    fireEvent.click(word);
    fireEvent.click(await enabledItem("Save"));

    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l1/items")).toBe(true),
    );
    const add = requests.find((r) => r.path === "/item-lists/l1/items");
    expect(add?.body).toEqual({ itemKind: "vocabulary", itemRef: "990101" });
    expect(await screen.findByText("Saved to Saved.")).toBeTruthy();
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(word));
  });

  it("Save to… picks another list", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    // Unknown words are saveable too — Saved Items is where they go to become Known.
    fireEvent.click(tokenButton("みせ"));
    fireEvent.click(await enabledItem("Save to…"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Travel" }));

    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l2/items")).toBe(true),
    );
    expect(requests.find((r) => r.path === "/item-lists/l2/items")?.body).toEqual({
      itemKind: "vocabulary",
      itemRef: "990103",
    });
    expect(await screen.findByText("Saved to Travel.")).toBeTruthy();
  });

  it("Save to… creates a new list and saves straight into it", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("みせ"));
    fireEvent.click(await enabledItem("Save to…"));
    fireEvent.change(screen.getByPlaceholderText("new list name"), { target: { value: "Food" } });
    fireEvent.click(screen.getByRole("menuitem", { name: "Create and save" }));

    await waitFor(() =>
      expect(
        requests.some((r) => r.method === "POST" && r.path === "/item-lists" && (r.body as { name?: string }).name === "Food"),
      ).toBe(true),
    );
    // The item lands in the freshly created list — the create's answer, not
    // a guess — and the picker never saves into a list that failed to exist.
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l3/items")).toBe(true),
    );
    expect(await screen.findByText("Saved to Food.")).toBeTruthy();
  });

  it("a Grammar Span token with no dictionary link saves the Grammar Point", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("しました"));
    const menu = screen.getByRole("menu");
    // No dictionary entry, so Dictionary stays disabled — but the covering
    // Span gives the token a save target: the Grammar Point itself.
    expect((within(menu).getByRole("menuitem", { name: "Dictionary" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(await enabledItem("Save"));

    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l1/items")).toBe(true),
    );
    expect(requests.find((r) => r.path === "/item-lists/l1/items")?.body).toEqual({
      itemKind: "grammar",
      itemRef: "12",
    });
    expect(await screen.findByText("Saved to Saved.")).toBeTruthy();
  });

  it("Save to… puts a Grammar Point in the chosen list", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("しました"));
    fireEvent.click(await enabledItem("Save to…"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Travel" }));

    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l2/items")).toBe(true),
    );
    expect(requests.find((r) => r.path === "/item-lists/l2/items")?.body).toEqual({
      itemKind: "grammar",
      itemRef: "12",
    });
    expect(await screen.findByText("Saved to Travel.")).toBeTruthy();
  });

  it("a linked word inside a Grammar Span still saves its own Dictionary Entry", async () => {
    const { client, requests } = fakeApi({ extraSpan: true });
    await openStory(client);

    // みせ sits inside the ～に行く span, yet Save means the word — the
    // span's Grammar Point is reached through the span's own tokens.
    fireEvent.click(tokenButton("みせ"));
    fireEvent.click(await enabledItem("Save"));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.path === "/item-lists/l1/items")).toBe(true),
    );
    expect(requests.find((r) => r.path === "/item-lists/l1/items")?.body).toEqual({
      itemKind: "vocabulary",
      itemRef: "990103",
    });
  });

  it("opening the Lookup Menu signals menu_open once per word, however often it opens", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    const word = tokenButton("がっこう");
    fireEvent.click(word); // open
    fireEvent.click(word); // close (same token toggles)
    fireEvent.click(word); // open again
    const signals = () => requests.filter((r) => r.path === "/weak-signals");
    await waitFor(() => expect(signals().length).toBe(1));
    expect((signals()[0]?.body as { signals: unknown }).signals).toEqual([
      { itemKind: "vocabulary", itemRef: "990101", reason: "menu_open" },
    ]);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(signals().length).toBe(1);
  });

  it("a Known lookup held past the configured threshold signals one Weak Signal", async () => {
    const { client, requests } = fakeApi({ lookupHoldMs: 30 });
    await openStory(client);

    fireEvent.mouseEnter(tokenButton("がっこう"));
    const signals = () => requests.filter((r) => r.path === "/weak-signals");
    expect(signals().length).toBe(0); // not before the threshold
    await waitFor(() => expect(signals().length).toBe(1));
    expect((signals()[0]?.body as { signals: unknown }).signals).toEqual([
      { itemKind: "vocabulary", itemRef: "990101", reason: "lookup" },
    ]);
  });

  it("a hold threshold of 0 signals every lookup, immediately", async () => {
    const { client, requests } = fakeApi({ lookupHoldMs: 0 });
    await openStory(client);

    // 0 means "signal every lookup": the timer exists and fires at once,
    // it is not switched off.
    fireEvent.mouseEnter(tokenButton("がっこう"));
    const signals = () => requests.filter((r) => r.path === "/weak-signals");
    await waitFor(() => expect(signals().length).toBe(1));
    expect((signals()[0]?.body as { signals: unknown }).signals).toEqual([
      { itemKind: "vocabulary", itemRef: "990101", reason: "lookup" },
    ]);
  });

  it("hovering away before the threshold cancels the hold", async () => {
    const { client, requests } = fakeApi({ lookupHoldMs: 200 });
    await openStory(client);

    fireEvent.mouseEnter(tokenButton("がっこう"));
    fireEvent.mouseLeave(tokenButton("がっこう"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 260));
    });
    expect(requests.some((r) => r.path === "/weak-signals")).toBe(false);
  });

  it("an unknown word's lookup never signals, however long it is held", async () => {
    const { client, requests } = fakeApi({ lookupHoldMs: 20 });
    await openStory(client);

    // みせ is unknown but dictionary-linked: the Lookup row fills, the hold
    // elapses — and no signal, because unknown lookups are ordinary study.
    fireEvent.mouseEnter(tokenButton("みせ"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(requests.some((r) => r.path === "/weak-signals")).toBe(false);
  });

  it("revealing the translation signals the sentence's Focus Set items only", async () => {
    const { client, requests } = fakeApi();
    await openStory(client);

    fireEvent.click(tokenButton("がっこう")); // selects sentence 0
    const panel = screen.getByLabelText("Reading Panel");
    fireEvent.click(panel.querySelector(".translation") as HTMLElement);

    await waitFor(() => expect(panel.querySelector(".translation.revealed")).toBeTruthy());
    await waitFor(() => {
      const unblur = requests
        .filter((r) => r.path === "/weak-signals")
        .flatMap((r) => (r.body as { signals: { reason: string }[] }).signals)
        .filter((s) => s.reason === "translation_unblur");
      // 学校 (in this sentence, focus) and the focus Grammar Span — while 店,
      // a focus item of the *other* sentence, stays out of it.
      expect(unblur).toEqual([
        { itemKind: "vocabulary", itemRef: "990101", reason: "translation_unblur" },
        { itemKind: "grammar", itemRef: "12", reason: "translation_unblur" },
      ]);
    });
  });
});
