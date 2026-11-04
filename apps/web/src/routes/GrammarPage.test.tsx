import { createApiClient, type ApiClient } from "@vjt/api-client";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider, useParams } from "react-router";

import { GrammarPointPage, parsePointId } from "./GrammarPointPage.tsx";
import { GrammarCatalogue } from "./GrammarPage.tsx";

/**
 * The Grammar Catalogue (ui-plan 4.6). The stub is the catalogue API the way the
 * Go server behaves: `q` (case-insensitive over pattern and meaning), `level`
 * and offset/limit are server-side, so the stub filters and slices rather than
 * the screen. A `source` on a point is present here only to exercise the badge;
 * the real list endpoint does not send it yet (API follow-up #65).
 */

interface SummaryFixture {
  id: number;
  jlptLevel: string;
  catalogueNumber: number;
  pattern: string;
  meaning: string;
  hasExplanation: boolean;
  exampleCount: number;
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
  const s: SummaryFixture = { id, jlptLevel, catalogueNumber, pattern, meaning, hasExplanation: true, exampleCount };
  if (source) s.source = source;
  return s;
}

/** Out of level order on purpose: the screen must order the groups itself. */
const POINTS: SummaryFixture[] = [
  summary(3, "N4", 1, "〜てくる", "come to do something", 2),
  summary(1, "N5", 1, "〜てしまう", "end up doing something", 1, "seeded"),
  summary(5, "N3", 3, "〜わけだ", "no wonder, that is why", 4, "seeded"),
  summary(2, "N5", 2, "〜たい", "want to do something", 0, "marumori"),
  summary(4, "N4", 5, "〜たら", "if, when (conditional)", 3, "observed"),
];

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
function renderCatalogue(fixture: Fixture, requests: string[], path = "/grammar") {
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
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

describe("Grammar Catalogue", () => {
  let fixture: Fixture;
  let requests: string[];

  beforeEach(() => {
    fixture = { status: 200, points: POINTS };
    requests = [];
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    // jsdom has no layout; the level index scrolls a group into view.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("groups the page under its JLPT levels, easiest first", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const levelHeadings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(levelHeadings).toEqual(["N5", "N4", "N3"]);
    expect(within(screen.getByRole("region", { name: "N5" })).getByText("〜たい")).toBeTruthy();
    expect(within(screen.getByRole("region", { name: "N3" })).getByText("〜わけだ")).toBeTruthy();
  });

  it("shows the level index from the sticky sidebar and jumps to a group without a hash in the URL", async () => {
    const { router } = renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const index = screen.getByRole("navigation", { name: "JLPT Levels" });
    const n3 = within(index).getByRole("link", { name: "N3" });
    fireEvent.click(n3);
    expect(router.state.location.hash).toBe("");
    expect(n3.getAttribute("href")).toBe("#grammar-level-N3");
  });

  it("searches case-insensitively through the meaning, and keeps the term in the URL", async () => {
    const { router } = renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    fireEvent.change(screen.getByLabelText("Search grammar"), { target: { value: "END UP" } });
    await waitFor(() => expect(screen.queryByText("〜たい")).toBeNull());
    expect(screen.getByText("〜てしまう")).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe("?q=END+UP"));
  });

  it("says where each point came from: Seeded, Observed, or Not recorded when the summary has no source", async () => {
    renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const n5 = screen.getByRole("region", { name: "N5" });
    expect(within(n5).getByText("Seeded")).toBeTruthy();
    expect(within(n5).getByText("Observed")).toBeTruthy();
    // 〜てくる has no source at all, which is what the real list sends today.
    expect(screen.getAllByText("Not recorded")).toHaveLength(1);
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

  it("pages Previous and Next over the whole catalogue", async () => {
    fixture.points = MANY_POINTS;
    const user = userEvent.setup();
    renderCatalogue(fixture, requests);
    await screen.findByText("1–50 of 120");
    expect(screen.getByRole("button", { name: "Previous" })).toHaveProperty("disabled", true);

    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("51–100 of 120");
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });

    await user.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByText("1–50 of 120");
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

  it("opens a point as a link to its own page, with its status and count in the label", async () => {
    const { router } = renderCatalogue(fixture, requests);
    await screen.findByText("〜てしまう");

    const row = screen.getByRole("link", { name: "〜てしまう, end up doing something, Seeded, 1 example" });
    fireEvent.click(row);
    await waitFor(() => expect(router.state.location.pathname).toBe("/grammar/1"));
  });

  it("returns from a point with the same search and page, and the same scroll position", async () => {
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
      await screen.findByRole("heading", { name: "〜たら" });

      await user.click(screen.getByRole("button", { name: "Back to grammar" }));
      await screen.findByText("51–100 of 120");
      expect(router.state.location.pathname).toBe("/grammar");
      expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 300 });
    } finally {
      Reflect.deleteProperty(window, "scrollY");
    }
  });
});
