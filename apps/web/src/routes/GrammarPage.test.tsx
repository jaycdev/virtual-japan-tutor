import { createApiClient, type ApiClient } from "@vjt/api-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider, useParams } from "react-router";

import { GrammarPointPage, parsePointId } from "./GrammarPointPage.tsx";
import { GrammarCatalogue } from "./GrammarPage.tsx";

/**
 * The Grammar Catalogue (ui-plan 4.6). The stub is the catalogue API the way the
 * Go server behaves: `q` (case-insensitive over pattern and meaning), `level` and
 * offset/limit are all server-side, so the stub filters and slices rather than
 * the screen. A `source` on a point is present only to exercise the status; the
 * real list endpoint does not send it yet (API follow-up #65).
 */

interface SummaryFixture {
  id: number;
  jlptLevel: string;
  catalogueNumber: number;
  pattern: string;
  meaning: string;
  hasExplanation: boolean;
  exampleCount: number;
  source?: string | null;
}

function summary(
  id: number,
  jlptLevel: string,
  catalogueNumber: number,
  pattern: string,
  meaning: string,
  exampleCount: number,
  source?: string | null,
): SummaryFixture {
  const s: SummaryFixture = { id, jlptLevel, catalogueNumber, pattern, meaning, hasExplanation: true, exampleCount };
  if (source !== undefined) s.source = source;
  return s;
}

/** Out of level order on purpose: the screen must order the groups itself. N2 and N1 are absent. */
const POINTS: SummaryFixture[] = [
  summary(3, "N4", 1, "〜てくる", "come to do something", 2),
  summary(1, "N5", 1, "〜てしまう", "end up doing something", 1, "seeded"),
  summary(5, "N3", 3, "〜わけだ", "no wonder, that is why", 4, "seeded"),
  summary(2, "N5", 2, "〜たい", "want to do something", 0, "marumori"),
  summary(4, "N4", 5, "〜たら", "if, when (conditional)", 3, "observed"),
];

/** The same catalogue with no `source` at all, as the real list API sends it today. */
const UNSOURCED: SummaryFixture[] = POINTS.map(({ source: _source, ...rest }) => rest);

/** Three levels of 40 points: a catalogue that needs paging (120 in all). */
const MANY_POINTS: SummaryFixture[] = ["N5", "N4", "N3"].flatMap((level, l) =>
  Array.from({ length: 40 }, (_, i) => summary(l * 100 + i + 1, level, i + 1, `〜${l}${i + 1}`, `pattern ${l}${i + 1}`, 0)),
);

const DETAIL = {
  id: 4,
  jlptLevel: "N4",
  catalogueNumber: 5,
  pattern: "〜たら",
  meaning: "if, when (conditional)",
  variants: [],
  explanation: "",
  explanationEdited: false,
  examples: [],
};

interface Fixture {
  status: number;
  points: SummaryFixture[];
  /** Hold the catalogue read until a test releases it (loading-state cases). */
  holdList?: boolean;
  release?: (response: Response) => void;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function stubFetch(fixture: Fixture, requests: string[]) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    requests.push(`${req.method} ${url.pathname}${url.search}`);

    const detail = /^\/grammar\/points\/(\d+)$/.exec(url.pathname);
    if (detail) return jsonResponse({ ...DETAIL, id: Number(detail[1]) });
    if (url.pathname !== "/grammar/points") return jsonResponse({ message: `unexpected ${url.pathname}` }, 500);

    if (fixture.holdList) {
      return new Promise<Response>((resolve) => {
        fixture.release = resolve;
      });
    }
    if (fixture.status !== 200) return jsonResponse({ message: "grammar down" }, fixture.status);

    const level = url.searchParams.get("level");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const matching = fixture.points.filter(
      (p) =>
        (!level || p.jlptLevel === level) &&
        (q === "" || p.pattern.toLowerCase().includes(q) || p.meaning.toLowerCase().includes(q)),
    );
    return jsonResponse({ items: matching.slice(offset, offset + limit), total: matching.length, limit, offset });
  };
}

/** The detail route, mounted the way appRoutes mounts it: it reads :grammarId from the URL. */
function DetailRoute({ client }: { client: ApiClient }) {
  const { grammarId } = useParams();
  return <GrammarPointPage client={client} pointId={parsePointId(grammarId)} />;
}

/** The app's two Grammar routes on a memory router, with an extra field to test the "/" key. */
function renderCatalogue(fixture: Fixture, requests: string[], entries: Array<string | Partial<{ pathname: string; search: string; state: unknown }>> = ["/grammar"]) {
  const client = createApiClient({ baseUrl: "http://api.test", fetch: stubFetch(fixture, requests) });
  const router = createMemoryRouter(
    [
      {
        element: (
          <>
            <input aria-label="Other field" />
            <Outlet />
          </>
        ),
        children: [
          { path: "/grammar", element: <GrammarCatalogue client={client} /> },
          { path: "/grammar/:grammarId", element: <DetailRoute client={client} /> },
          { path: "/practice", element: <p>Practice page</p> },
        ],
      },
    ],
    { initialEntries: entries },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

describe("Grammar Catalogue", () => {
  let fixture: Fixture;
  let requests: string[];

  beforeEach(() => {
    fixture = { status: 200, points: POINTS };
    requests = [];
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    // jsdom has no layout; focusing a heading and scrolling are checked, not measured.
    Element.prototype.scrollIntoView = vi.fn();
    window.sessionStorage.clear();
  });

  it("groups the page under its JLPT levels, easiest first", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const levelHeadings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(levelHeadings).toEqual(["N5", "N4", "N3"]);
    expect(within(screen.getByRole("region", { name: "N5" })).getByText("〜たい")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "N3" })).getByText("〜わけだ")).toBeTruthy();
  });

  it("always lists All levels and N5 to N1 in the index, even the levels this page does not have", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const index = screen.getByRole("navigation", { name: "JLPT Levels" });
    const labels = within(index).getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["All levels", "N5", "N4", "N3", "N2", "N1"]);
    // The level with no points on this page is still there, and marks the current view.
    expect(within(index).getByRole("button", { name: "All levels" }).getAttribute("aria-current")).toBe("true");
  });

  it("filters to a level chosen from the index, on the server, and keeps it in ?level=", async () => {
    const user = userEvent.setup();
    const { router } = renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    await user.click(within(screen.getByRole("navigation", { name: "JLPT Levels" })).getByRole("button", { name: "N4" }));
    await waitFor(() => expect(screen.queryByText("〜てしまう")).toBeNull());
    expect(screen.getByText("〜たら")).toBeTruthy();
    expect(screen.getByText("〜てくる")).toBeTruthy();
    expect(requests.some((r) => r.includes("level=N4"))).toBe(true);
    expect(router.state.location.search).toBe("?level=N4");
    expect(within(screen.getByRole("navigation", { name: "JLPT Levels" })).getByRole("button", { name: "N4" }).getAttribute("aria-current")).toBe("true");
  });

  it("says so, with a way out, when the chosen level has no points", async () => {
    const user = userEvent.setup();
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    await user.click(within(screen.getByRole("navigation", { name: "JLPT Levels" })).getByRole("button", { name: "N1" }));
    await screen.findByText("No N1 Grammar Points in the catalogue.");

    await user.click(screen.getByRole("button", { name: "Show all levels" }));
    await screen.findByText("〜てしまう");
    expect(screen.getByRole("navigation", { name: "JLPT Levels" }).querySelector('[aria-current="true"]')?.textContent).toBe("All levels");
  });

  it("moves focus to the results heading after a level is chosen", async () => {
    const user = userEvent.setup();
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    await user.click(within(screen.getByRole("navigation", { name: "JLPT Levels" })).getByRole("button", { name: "N5" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("N5"));
    expect(document.activeElement?.tagName).toBe("H2");
  });

  it("seeds the level filter from ?level= on arrival, in one request", async () => {
    renderCatalogue(fixture, requests, ["/grammar?level=N5"]);
    await screen.findByText("〜てしまう");

    const reads = requests.filter((r) => r.startsWith("GET /grammar/points"));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toContain("level=N5");
    expect(screen.queryByText("〜たら")).toBeNull();
  });

  it("shows no status at all while the summary carries no source (#65)", async () => {
    fixture.points = UNSOURCED;
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    expect(screen.queryByText("Seeded")).toBeNull();
    expect(screen.queryByText("Observed")).toBeNull();
    expect(screen.queryByText("Not known")).toBeNull();
    expect(screen.queryByText("Not recorded")).toBeNull();
    // The row's accessible name carries no status either.
    expect(screen.getByRole("link", { name: "〜てしまう, end up doing something, 1 example" })).toBeTruthy();
  });

  it("shows Seeded, Observed and Not known once the source is sent", async () => {
    fixture.points = [...POINTS, summary(6, "N5", 9, "〜ぞ", "emphatic sentence ender", 0, "something-new")];
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const n5 = screen.getByRole("region", { name: "N5" });
    expect(within(n5).getByText("Seeded")).toBeTruthy();
    expect(within(n5).getByText("Observed")).toBeTruthy();
    expect(within(n5).getByText("Not known")).toBeTruthy();
    expect(screen.getByRole("link", { name: "〜てしまう, end up doing something, Seeded, 1 example" })).toBeTruthy();
  });

  it("searches case-insensitively through the meaning, and keeps the term in the URL", async () => {
    const { router } = renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "END UP" } });
    await waitFor(() => expect(screen.queryByText("〜たい")).toBeNull());
    expect(screen.getByText("〜てしまう")).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe("?q=END+UP"));
  });

  it("follows the URL when the Grammar link is clicked mid-search: the box clears and the list unfilters (review: URL sync)", async () => {
    const { router } = renderCatalogue(fixture, requests, ["/grammar?q=zzzz"]);
    // The search from the URL is applied on arrival.
    await screen.findByText(/Nothing matches “zzzz”/);
    expect((screen.getByLabelText("Search grammar") as HTMLInputElement).value).toBe("zzzz");

    // The sidebar's Grammar link: same route, no search.
    await router.navigate("/grammar");

    await waitFor(() => expect((screen.getByLabelText("Search grammar") as HTMLInputElement).value).toBe(""));
    await screen.findByText("〜てしまう");
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
    expect(screen.getByText("〜たい")).toBeTruthy();
  });

  it("also follows a changed ?q= from outside, not only a cleared one", async () => {
    const { router } = renderCatalogue(fixture, requests, ["/grammar?q=end"]);
    await screen.findByText("〜てしまう");

    await router.navigate("/grammar?q=conditional");
    await waitFor(() => expect((screen.getByLabelText("Search grammar") as HTMLInputElement).value).toBe("conditional"));
    await screen.findByText("〜たら");
    expect(screen.queryByText("〜てしまう")).toBeNull();
  });

  it("holds a skeleton shaped like the page while the catalogue loads, then fills it", async () => {
    fixture.holdList = true;
    renderCatalogue(fixture, requests);
    expect(await screen.findByTestId("grammar-list-skeleton")).toBeTruthy();
    expect(screen.queryByText("〜てしまう")).toBeNull();

    fixture.release?.(jsonResponse({ items: POINTS, total: POINTS.length, limit: 50, offset: 0 }));
    await screen.findByText("〜てしまう");
    expect(screen.queryByTestId("grammar-list-skeleton")).toBeNull();
  });

  it("says so when the catalogue cannot load, and retries in place", async () => {
    fixture.status = 500;
    const user = userEvent.setup();
    renderCatalogue(fixture, requests);
    await screen.findByText(/Cannot load grammar points: grammar down/);

    const before = requests.filter((r) => r.startsWith("GET /grammar/points")).length;
    fixture.status = 200;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("〜てしまう");
    expect(requests.filter((r) => r.startsWith("GET /grammar/points")).length).toBeGreaterThan(before);
  });

  it("offers a way out of a search that matches nothing", async () => {
    const user = userEvent.setup();
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "zzzz" } });
    await screen.findByText(/Nothing matches “zzzz”/);

    // A string name matches the whole accessible name, so this is not "Clear search term".
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    await screen.findByText("〜たら");
  });

  it("shows a count line instead of a dead pager when the results fit one page", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    expect(screen.getByText("5 Grammar Points")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("pages Previous and Next, keeping the page in ?page= with replace, not push", async () => {
    fixture.points = MANY_POINTS;
    const user = userEvent.setup();
    const { router } = renderCatalogue(fixture, requests);
    await screen.findByText("1–50 of 120");
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("51–100 of 120");
    expect(router.state.location.search).toBe("?page=2");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("1–50 of 120");
    expect(router.state.location.search).toBe("");
  });

  it("seeds the page from ?page= on arrival", async () => {
    fixture.points = MANY_POINTS;
    renderCatalogue(fixture, requests, ["/grammar?page=3"]);
    await screen.findByText("101–120 of 120");
    expect(requests.some((r) => r.includes("offset=100"))).toBe(true);
  });

  it("keeps the search and the page together in the URL, and a new search starts at page one", async () => {
    fixture.points = MANY_POINTS;
    const user = userEvent.setup();
    // Every point's meaning contains "pattern", so this search spans all 120 and pages.
    const { router } = renderCatalogue(fixture, requests, ["/grammar?q=pattern&page=2"]);
    await screen.findByText("51–100 of 120");
    expect(requests.some((r) => r.includes("q=pattern") && r.includes("offset=50"))).toBe(true);

    // Paging within the search keeps q and moves page.
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("101–120 of 120");
    const onPageThree = new URLSearchParams(router.state.location.search);
    expect(onPageThree.get("q")).toBe("pattern");
    expect(onPageThree.get("page")).toBe("3");

    // A new search drops the page and starts at page one.
    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "pattern 1" } });
    await waitFor(() => expect(router.state.location.search).toBe("?q=pattern+1"));
  });

  it("sends one search for a burst of keystrokes", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const input = screen.getByLabelText("Search grammar");
    fireEvent.change(input, { target: { value: "e" } });
    fireEvent.change(input, { target: { value: "en" } });
    fireEvent.change(input, { target: { value: "end" } });

    await waitFor(() => expect(requests.some((r) => r.includes("q=end"))).toBe(true));
    expect(requests.filter((r) => r.includes("q="))).toHaveLength(1);
  });

  it("drops the pending search when the screen goes away mid-debounce", async () => {
    const { unmount } = renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "end" } });
    unmount(); // leave before the debounce deadline passes

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(requests.filter((r) => r.includes("q="))).toHaveLength(0);
  });

  it("moves to search with the / key from outside a field, but not while typing in one", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    fireEvent.keyDown(document.body, { key: "/" });
    expect(document.activeElement).toBe(screen.getByLabelText("Search grammar"));

    const other = screen.getByLabelText("Other field");
    other.focus();
    fireEvent.keyDown(other, { key: "/" });
    expect(document.activeElement).toBe(other);
  });

  it("ignores / while an IME is composing, and when something else already handled the key", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");
    const search = screen.getByLabelText("Search grammar");

    fireEvent.keyDown(document.body, { key: "/", isComposing: true });
    expect(document.activeElement).not.toBe(search);

    const handled = (event: Event) => event.preventDefault();
    document.body.addEventListener("keydown", handled);
    try {
      fireEvent.keyDown(document.body, { key: "/" });
      expect(document.activeElement).not.toBe(search);
    } finally {
      document.body.removeEventListener("keydown", handled);
    }
  });

  it("opens a point as a link to its own page, marked as opened from the catalogue", async () => {
    const { router } = renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    fireEvent.click(screen.getByRole("link", { name: "〜てしまう, end up doing something, Seeded, 1 example" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/grammar/1"));
    expect(router.state.location.state).toEqual({ from: "grammar" });
  });

  it("returns from a point with the same search, page and scroll position", async () => {
    fixture.points = MANY_POINTS;
    const user = userEvent.setup();
    Object.defineProperty(window, "scrollY", { value: 300, configurable: true });
    try {
      const { router } = renderCatalogue(fixture, requests);
      await screen.findByText("1–50 of 120");
      await user.click(screen.getByRole("button", { name: "Next" }));
      await screen.findByText("51–100 of 120");

      const firstRow = screen.getAllByRole("link").find((a) => a.getAttribute("href")?.startsWith("/grammar/"));
      if (!firstRow) throw new Error("no catalogue row on page two");
      await user.click(firstRow);
      await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/grammar\/\d+$/));
      await screen.findByRole("heading", { name: /〜たら/ });

      await user.click(screen.getByRole("button", { name: "Back to grammar" }));
      await screen.findByText("51–100 of 120");
      expect(router.state.location.pathname).toBe("/grammar");
      expect(router.state.location.search).toBe("?page=2");
      expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 300 });
    } finally {
      Reflect.deleteProperty(window, "scrollY");
    }
  });
});
