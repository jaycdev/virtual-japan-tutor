import { createApiClient, type ApiClient } from "@vjt/api-client";
import { InterfaceLanguageProvider } from "@vjt/core";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flushPressConfig } from "../test/press-config.ts";
import { Grammar, groupByLevel, resetGrammarBrowsePosition } from "./Grammar.tsx";
import { unrubyfiedKanji } from "./test/kanjiCoverage.ts";

/**
 * Grammar Catalogue (#49). The stub is the catalogue API the way the Go server
 * behaves: `level`, `q` (case-insensitive over pattern and meaning) and
 * offset/limit are all server-side parameters, so the stub filters and slices
 * rather than the screen. `source` — Seeded/Observed — is deliberately present
 * here and absent from the real list endpoint (the API gap reported on #49),
 * which is why rows without it must render "Not recorded".
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface SummaryFixture {
  id: number;
  jlptLevel: string;
  catalogueNumber: number;
  pattern: string;
  meaning: string;
  hasExplanation: boolean;
  exampleCount: number;
  /** Not in the real API's list payload; see the issue #49 gap report. */
  source?: "seeded" | "observed" | "marumori";
}

function summary(
  id: number,
  jlptLevel: string,
  catalogueNumber: number,
  pattern: string,
  meaning: string,
  exampleCount: number,
  source?: SummaryFixture["source"],
): SummaryFixture {
  const s: SummaryFixture = {
    id,
    jlptLevel,
    catalogueNumber,
    pattern,
    meaning,
    hasExplanation: true,
    exampleCount,
  };
  if (source) s.source = source;
  return s;
}

/** Deliberately out of level order: the screen must order the groups itself. */
const POINTS: SummaryFixture[] = [
  summary(3, "N4", 1, "〜ようになる", "come to do something", 2),
  summary(1, "N5", 1, "〜てしまう", "end up doing something", 1, "seeded"),
  summary(5, "N3", 3, "〜わけだ", "no wonder, that is why", 4, "seeded"),
  summary(2, "N5", 2, "〜たい", "want to do something", 0, "marumori"),
  summary(4, "N4", 5, "〜たら", "if, when (conditional)", 3, "observed"),
];

/** Bigger catalogue for the paging case: 120 points, 40 per level. */
const MANY_POINTS: SummaryFixture[] = ["N5", "N4", "N3"].flatMap((level, l) =>
  Array.from({ length: 40 }, (_, i) => summary(l * 100 + i + 1, level, i + 1, `〜文${i + 1}`, `pattern ${i + 1}`, 0)),
);

type Fixture = {
  status: number;
  points: SummaryFixture[];
  /** Resolve /grammar/points only when a test says so (loading-state cases). */
  holdList?: boolean;
};

describe("Grammar catalogue", () => {
  let fixture: Fixture;
  let fetchMock: ReturnType<typeof vi.fn>;
  let gets: string[];
  let releaseList: ((value: Response) => void) | null;

  beforeEach(() => {
    fixture = { status: 200, points: POINTS, holdList: false };
    gets = [];
    releaseList = null;
    resetGrammarBrowsePosition();
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const url = new URL(request.url);
      const path = url.pathname;
      gets.push(`${request.method} ${path}${url.search}`);
      if (path !== "/grammar/points") return jsonResponse({ message: `stub: unexpected GET ${path}` }, 500);

      if (fixture.holdList) return new Promise<Response>((resolve) => (releaseList = resolve));
      if (fixture.status !== 200) return jsonResponse({ message: "grammar down" }, fixture.status);

      // The server's own filter and paging (grammar.go / pgstore.go).
      const level = url.searchParams.get("level");
      const q = url.searchParams.get("q") ?? "";
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const like = q.toLowerCase();
      const matching = fixture.points.filter(
        (p) =>
          (!level || p.jlptLevel === level) &&
          (like === "" || p.pattern.toLowerCase().includes(like) || p.meaning.toLowerCase().includes(like)),
      );
      return jsonResponse({
        items: matching.slice(offset, offset + limit),
        total: matching.length,
        limit,
        offset,
      });
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderGrammar(onOpenPoint = vi.fn()): { client: ApiClient; onOpenPoint: ReturnType<typeof vi.fn> } {
    const client = createApiClient({ baseUrl: "http://localhost", fetch: fetchMock as unknown as typeof fetch });
    render(<Grammar client={client} onOpenPoint={onOpenPoint} />);
    return { client, onOpenPoint };
  }

  it("groups the page under its JLPT levels, easiest first", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    // Section headings appear in plan order even though the page did not.
    const headings = screen.getAllByRole("heading").map((h) => h.textContent);
    expect(headings).toEqual(["Grammar", "N5", "N4", "N3"]);

    // And each point sits in its own group's card.
    expect(within(screen.getByTestId("grammar-group-N5")).getByText("〜たい")).toBeTruthy();
    expect(within(screen.getByTestId("grammar-group-N4")).getByText("〜たら")).toBeTruthy();
    expect(within(screen.getByTestId("grammar-group-N3")).getByText("〜わけだ")).toBeTruthy();
  });

  it("searches case-insensitively through the meaning, not only the pattern", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    // "END UP" is nowhere in any pattern; it is in one point's meaning.
    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "END UP" } });
    await waitFor(() => expect(screen.queryByText("〜たい")).toBeNull());
    expect(screen.getByText("〜てしまう")).toBeTruthy();
    // The term went to the server's filter, as the old web catalogue did.
    expect(gets.some((call) => call.includes("q=END+UP") || call.includes("q=END%20UP"))).toBe(true);
  });

  it("shows where each point came from: Seeded, Observed or neither", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    expect(within(screen.getByTestId("grammar-group-N5")).getByText("Seeded")).toBeTruthy();
    // The sync's own source value, "marumori", also reads as Observed.
    expect(within(screen.getByTestId("grammar-group-N5")).getByText("Observed")).toBeTruthy();
    // 〜ようになる carries no source at all — which is what the real list API
    // returns for every point today (issue #49 report) — and says so quietly
    // rather than guessing. 〜わけだ is Seeded in N3.
    expect(screen.getAllByText("Not recorded")).toHaveLength(1);
    expect(within(screen.getByTestId("grammar-group-N3")).getByText("Seeded")).toBeTruthy();
  });

  it("holds skeletons while the catalogue loads, then fills them", async () => {
    fixture.holdList = true;
    renderGrammar();
    await waitFor(() => expect(screen.getByTestId("grammar-list-skeleton")).toBeTruthy());
    expect(screen.queryByText("〜てしまう")).toBeNull();

    expect(releaseList).not.toBeNull();
    (releaseList as unknown as (value: Response) => void)(
      jsonResponse({ items: POINTS, total: POINTS.length, limit: 50, offset: 0 }),
    );
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());
    expect(screen.queryByTestId("grammar-list-skeleton")).toBeNull();
  });

  it("says so when the catalogue cannot be loaded, and retries in place", async () => {
    fixture.status = 500;
    renderGrammar();
    await waitFor(() => expect(screen.getByText(/Cannot load grammar points: grammar down/)).toBeTruthy());

    const before = gets.filter((call) => call.includes("/grammar/points")).length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(gets.filter((call) => call.includes("/grammar/points")).length).toBeGreaterThan(before),
    );
  });

  it("offers a way out of a search that matches nothing", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "zzzz" } });
    await waitFor(() => expect(screen.getByText(/Nothing matches/)).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(screen.getByText("〜わけだ")).toBeTruthy());
  });

  it("shows a plain count instead of a dead pager when the results fit one page (#49 review S5)", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    expect(screen.getByText("5 Grammar Points")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("pages Previous and Next over the whole catalogue", async () => {
    fixture.points = MANY_POINTS;
    renderGrammar();
    await waitFor(() => expect(screen.getByText("1–50 of 120")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Previous" }).getAttribute("aria-disabled")).toBe("true");

    await flushPressConfig();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(gets.some((call) => call.includes("offset=50"))).toBe(true));
    await waitFor(() => expect(screen.getByText("51–100 of 120")).toBeTruthy());

    await flushPressConfig();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(gets.some((call) => call.includes("offset=0"))).toBe(true));
    await waitFor(() => expect(screen.getByText("1–50 of 120")).toBeTruthy());
  });

  it("sends one debounced request for a burst of keystrokes (#49 review N3)", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    const input = screen.getByLabelText("Search grammar");
    fireEvent.change(input, { target: { value: "e" } });
    fireEvent.change(input, { target: { value: "en" } });
    fireEvent.change(input, { target: { value: "end" } });

    // All three keystrokes land well inside the 300 ms window, and the burst
    // settles into exactly one search — the term as finally typed.
    await waitFor(() => expect(gets.some((call) => call.includes("q=end"))).toBe(true));
    expect(gets.filter((call) => call.includes("q="))).toHaveLength(1);
  });

  it("drops the pending search when the screen goes away mid-debounce (#49 review N3)", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "end" } });
    cleanup(); // leave before the debounce deadline passes

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(gets.filter((call) => call.includes("q="))).toHaveLength(0);
  });

  it("opens a point through the host’s route, not in place", async () => {
    const { onOpenPoint } = renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "〜てしまう, end up doing something, Seeded, 1 example" }));
    expect(onOpenPoint).toHaveBeenCalledWith(1);
  });

  it("announces status and example count in each row’s label, not just pattern and meaning", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());

    // The label replaces the row's text for a screen reader, so every fact the
    // visible row shows has to be in it (#49 review S2).
    expect(
      screen.getByRole("button", { name: "〜たら, if, when (conditional), Observed, 3 examples" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "〜ようになる, come to do something, Not recorded, 2 examples" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "〜たい, want to do something, Observed, 0 examples" }),
    ).toBeTruthy();
  });

  it("keeps the search term across a detail visit and Back (#49 review S3)", async () => {
    renderGrammar();
    await waitFor(() => expect(screen.getByText("〜てしまう")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "conditional" } });
    await waitFor(() => expect(screen.queryByText("〜たい")).toBeNull());
    expect(screen.getByText("〜たら")).toBeTruthy();

    // Open a point, come Back: the screen unmounts and mounts again.
    const callsBefore = gets.length;
    cleanup();
    renderGrammar();

    await waitFor(() =>
      expect((screen.getByLabelText("Search grammar") as HTMLInputElement).value).toBe("conditional"),
    );
    // One restored read, and it carries the term — no unfiltered page one, and
    // the debounce does not fire a second read on top of the restored filter.
    expect(gets.slice(callsBefore).filter((c) => c.startsWith("GET /grammar/points"))).toEqual([
      expect.stringContaining("q=conditional"),
    ]);
    expect(screen.getByText("〜たら")).toBeTruthy();
  });

  it("keeps the page across a detail visit and Back (#49 review S3)", async () => {
    fixture.points = MANY_POINTS;
    renderGrammar();
    await waitFor(() => expect(screen.getByText("1–50 of 120")).toBeTruthy());
    await flushPressConfig();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(gets.some((c) => c.includes("offset=50"))).toBe(true));

    const callsBefore = gets.length;
    cleanup();
    renderGrammar();

    await waitFor(() => expect(screen.getByText("51–100 of 120")).toBeTruthy());
    expect(gets.slice(callsBefore).filter((c) => c.startsWith("GET /grammar/points"))).toEqual([
      expect.stringContaining("offset=50"),
    ]);
  });

  it("in Japanese (furigana) every chrome kanji stands in a reading column", async () => {
    // The page chrome — title, status badges, the count caption, the pager —
    // comes from the string table; the Patterns and Meanings are the
    // catalogue's own content and sit outside the rule. 〜文N puts kanji in
    // every row so a bare pattern would be caught.
    fixture.points = MANY_POINTS;
    const client = createApiClient({ baseUrl: "http://localhost", fetch: fetchMock as unknown as typeof fetch });
    render(
      <InterfaceLanguageProvider language="ja-furigana" setLanguage={() => undefined}>
        <Grammar client={client} onOpenPoint={vi.fn()} />
      </InterfaceLanguageProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId("grammar-pattern").length).toBeGreaterThan(0));

    expect(document.querySelectorAll("[style*='font-size']").length).toBeGreaterThan(0);
    expect(unrubyfiedKanji(document.body, ["grammar-pattern", "grammar-meaning"])).toEqual([]);
  });
});

describe("groupByLevel", () => {
  it("keeps the server’s order inside each level and unknown levels last", () => {
    const rows = [
      summary(9, "N9", 1, "〜未知", "not a real level", 0),
      summary(3, "N4", 2, "b", "second N4", 0),
      summary(2, "N4", 1, "a", "first N4", 0),
      summary(1, "N5", 1, "c", "N5", 0),
    ];
    const groups = groupByLevel(rows as unknown as Parameters<typeof groupByLevel>[0]);
    expect(groups.map((g) => g.level)).toEqual(["N5", "N4", "N9"]);
    expect(groups[1].points.map((p) => p.pattern)).toEqual(["b", "a"]);
  });
});
