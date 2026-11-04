import { createApiClient, type ApiClient } from "@vjt/api-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider, useParams } from "react-router";

import { GrammarPointPage, parsePointId } from "./GrammarPointPage.tsx";

/**
 * Grammar Point detail (ui-plan 4.6). The generating wait is the read itself: the
 * server writes a missing explanation inside GET /grammar/points/{id}, so the
 * "generating" case is a held response that lands a moment later.
 */

/** One validated example; the bad-offset cases override its offsets. */
const EXAMPLE = {
  id: "11111111-1111-1111-1111-111111111111",
  sentenceJa: "宿題を忘れた。",
  translationEn: "I forgot my homework.",
  spanStart: 5,
  spanEnd: 7,
  spanText: "忘れた",
  source: "ai" as const,
};

const DETAIL = {
  id: 12,
  jlptLevel: "N4",
  catalogueNumber: 12,
  pattern: "〜てしまう",
  meaning: "end up doing something",
  variants: ["〜ちゃう"],
  explanation:
    "Form: **verb-te form** + しまう. The helper softens the main verb.\n\n- Something completed, often with regret\n- An unintended result",
  explanationEdited: false,
  examples: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      sentenceJa: "宿題を忘れてしまった。",
      translationEn: "I ended up forgetting my homework.",
      spanStart: 5,
      spanEnd: 10,
      spanText: "てしまった",
      source: "ai",
    },
  ],
};

interface Fixture {
  status: number;
  detail: unknown;
  hold?: boolean;
  release?: (response: Response) => void;
}

function stubFetch(fixture: Fixture, requests: string[]) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    requests.push(`${req.method} ${url.pathname}`);
    const match = /^\/grammar\/points\/(\d+)$/.exec(url.pathname);
    if (!match) return Response.json({ message: `unexpected ${url.pathname}` }, { status: 500 });
    if (fixture.hold) {
      return new Promise<Response>((resolve) => {
        fixture.release = resolve;
      });
    }
    if (fixture.status !== 200) return Response.json({ message: "grammar down" }, { status: fixture.status });
    return Response.json(fixture.detail);
  };
}

function DetailRoute({ client }: { client: ApiClient }) {
  const { grammarId } = useParams();
  return <GrammarPointPage client={client} pointId={parsePointId(grammarId)} />;
}

/** The detail on a memory router with a catalogue entry beneath it, so Back has somewhere to go. */
type Entry = string | { pathname: string; state?: unknown };

/** The state a catalogue row sends with its link (see GrammarPage's PointRow). */
const FROM_CATALOGUE = { from: "grammar" };

function renderDetail(fixture: Fixture, requests: string[], entries: Entry[]) {
  const client = createApiClient({ baseUrl: "http://api.test", fetch: stubFetch(fixture, requests) });
  const router = createMemoryRouter(
    [
      { path: "/grammar", element: <p>Catalogue page</p> },
      { path: "/practice", element: <p>Practice page</p> },
      { path: "/grammar/:grammarId", element: <DetailRoute client={client} /> },
    ],
    { initialEntries: entries, initialIndex: entries.length - 1 },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

describe("Grammar Point detail", () => {
  let fixture: Fixture;
  let requests: string[];

  beforeEach(() => {
    fixture = { status: 200, detail: DETAIL };
    requests = [];
  });

  it("shows the pattern, level, number, meaning and variants in the header", async () => {
    renderDetail(fixture, requests, ["/grammar/12"]);
    await screen.findByRole("heading", { level: 1, name: "〜てしまう" });
    expect(screen.getByText("N4")).toBeTruthy();
    expect(screen.getByText("#12")).toBeTruthy();
    expect(screen.getByText("end up doing something")).toBeTruthy();
    expect(screen.getByText("Also written 〜ちゃう")).toBeTruthy();
  });

  it("reads only its own point, not the catalogue", async () => {
    renderDetail(fixture, requests, ["/grammar/12"]);
    await screen.findByRole("heading", { level: 1, name: "〜てしまう" });
    expect(requests.filter((r) => r === "GET /grammar/points")).toHaveLength(0);
    expect(requests.filter((r) => r === "GET /grammar/points/12")).toHaveLength(1);
  });

  it("renders the explanation as prose, bullets and bold runs, never as raw markdown", async () => {
    renderDetail(fixture, requests, ["/grammar/12"]);
    const explanation = await screen.findByRole("region", { name: "Explanation" });

    const bullets = Array.from(explanation.querySelectorAll("li")).map((li) => li.textContent);
    expect(bullets).toEqual(["Something completed, often with regret", "An unintended result"]);
    expect(explanation.querySelector("strong")?.textContent).toBe("verb-te form");
    expect(explanation.textContent).not.toContain("**");
    expect(explanation.textContent).toContain("Form: verb-te form + しまう. The helper softens the main verb.");
  });

  it("marks the Grammar Span in each example and shows the translation", async () => {
    renderDetail(fixture, requests, ["/grammar/12"]);
    const examples = await screen.findByRole("region", { name: "Example sentences" });

    const sentence = examples.querySelector('p[lang="ja"]');
    expect(sentence?.textContent).toBe("宿題を忘れてしまった。");
    expect(examples.querySelector("mark")?.textContent).toBe("てしまった");
    expect(screen.getByText("I ended up forgetting my homework.")).toBeTruthy();
  });

  it("treats the server's text as text: markup in it is shown, not run", async () => {
    fixture.detail = {
      ...DETAIL,
      explanation: '<img src="x" onerror="window.__pwned=1">**safe**',
    };
    renderDetail(fixture, requests, ["/grammar/12"]);
    const explanation = await screen.findByRole("region", { name: "Explanation" });

    expect(explanation.querySelector("img")).toBeNull();
    expect(explanation.textContent).toContain('<img src="x" onerror="window.__pwned=1">');
  });

  it("says the page is being prepared while the first read is in flight", async () => {
    fixture.hold = true;
    renderDetail(fixture, requests, ["/grammar/12"]);
    expect(await screen.findByTestId("grammar-detail-skeleton")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/Preparing this page/);
    expect(screen.queryByRole("region", { name: "Explanation" })).toBeNull();

    fixture.release?.(Response.json(DETAIL));
    await screen.findByRole("region", { name: "Explanation" });
    expect(screen.queryByTestId("grammar-detail-skeleton")).toBeNull();
  });

  it("reports a failed read with Retry in place, and reads again on Retry", async () => {
    fixture.status = 500;
    const user = userEvent.setup();
    renderDetail(fixture, requests, ["/grammar/12"]);
    await screen.findByText(/Cannot load this grammar point: grammar down/);

    const before = requests.length;
    fixture.status = 200;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("heading", { level: 1, name: "〜てしまう" });
    expect(requests.length).toBeGreaterThan(before);
  });

  it("admits a failed generation and offers Reload, rather than claiming the page was never opened", async () => {
    fixture.detail = { ...DETAIL, explanation: "", examples: [] };
    const user = userEvent.setup();
    renderDetail(fixture, requests, ["/grammar/12"]);
    await screen.findByText(/could not generate this explanation/);
    expect(screen.getByText(/Check the AI Provider for grammar content in Settings/)).toBeTruthy();
    expect(screen.queryByText(/first time this page is opened/)).toBeNull();
    expect(screen.getByText("No validated examples yet.")).toBeTruthy();

    const before = requests.filter((r) => r === "GET /grammar/points/12").length;
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(requests.filter((r) => r === "GET /grammar/points/12").length).toBeGreaterThan(before),
    );
  });

  it("goes back, in history, to the catalogue when a catalogue row opened the page", async () => {
    const user = userEvent.setup();
    const { router } = renderDetail(fixture, requests, [
      "/grammar",
      { pathname: "/grammar/12", state: FROM_CATALOGUE },
    ]);
    await screen.findByRole("heading", { level: 1, name: "〜てしまう" });

    await user.click(screen.getByRole("button", { name: "Back to grammar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/grammar"));
    // A real Back (a pop), so the catalogue is the entry the Learner left.
    expect(router.state.historyAction).toBe("POP");
  });

  it("replaces to the catalogue after a reload or a fresh link, with nothing to go back to", async () => {
    const user = userEvent.setup();
    const { router } = renderDetail(fixture, requests, ["/grammar/12"]);
    await screen.findByRole("heading", { level: 1, name: "〜てしまう" });

    await user.click(screen.getByRole("button", { name: "Back to grammar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/grammar"));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("does not pop to an unrelated screen: from Practice, Back opens the catalogue instead", async () => {
    const user = userEvent.setup();
    // The Learner went Practice -> a point link that did not come from the catalogue.
    const { router } = renderDetail(fixture, requests, ["/practice", "/grammar/12"]);
    await screen.findByRole("heading", { level: 1, name: "〜てしまう" });

    await user.click(screen.getByRole("button", { name: "Back to grammar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/grammar"));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("does not pop when the history state is something other than the catalogue's mark", async () => {
    const user = userEvent.setup();
    const { router } = renderDetail(fixture, requests, ["/practice", { pathname: "/grammar/12", state: { from: "practice" } }]);
    await screen.findByRole("heading", { level: 1, name: "〜てしまう" });

    await user.click(screen.getByRole("button", { name: "Back to grammar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/grammar"));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("renders an ordered list in the explanation as a numbered list", async () => {
    fixture.detail = { ...DETAIL, explanation: "Steps:\n\n1. first step\n2. second step" };
    renderDetail(fixture, requests, ["/grammar/12"]);
    const explanation = await screen.findByRole("region", { name: "Explanation" });
    const ordered = explanation.querySelector("ol");
    expect(ordered).not.toBeNull();
    expect(Array.from(ordered?.querySelectorAll("li") ?? []).map((li) => li.textContent)).toEqual([
      "first step",
      "second step",
    ]);
  });

  it("clamps bad example offsets: the page still renders and marks only text that exists", async () => {
    fixture.detail = {
      ...DETAIL,
      examples: [
        { ...EXAMPLE, id: "a", spanStart: 3, spanEnd: 99, translationEn: "end past the sentence" },
        { ...EXAMPLE, id: "b", spanStart: 40, spanEnd: 50, translationEn: "start past the sentence" },
        { ...EXAMPLE, id: "c", spanStart: 4, spanEnd: 1, translationEn: "end before the start" },
      ],
    };
    renderDetail(fixture, requests, ["/grammar/12"]);
    const examples = await screen.findByRole("region", { name: "Example sentences" });
    // The sentence is 7 runes: 宿題を忘れた。 . The sentence text itself never changes.
    const sentences = Array.from(examples.querySelectorAll('p[lang="ja"]'));
    expect(sentences.map((p) => p.textContent)).toEqual(["宿題を忘れた。", "宿題を忘れた。", "宿題を忘れた。"]);
    const marks = Array.from(examples.querySelectorAll("mark")).map((m) => m.textContent);
    // Start 3 with an end past the sentence: the mark runs to the end (忘れた。).
    expect(marks[0]).toBe("忘れた。");
    // A start past the end, and an end before the start, mark nothing.
    expect(marks[1]).toBe("");
    expect(marks[2]).toBe("");
  });

  it("names a route id that is not a catalogue point, without asking the server", async () => {
    renderDetail(fixture, requests, ["/grammar/abc"]);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("This is not a grammar point from the catalogue.")).toBeTruthy();
    expect(requests.some((r) => r.startsWith("GET /grammar/points/"))).toBe(false);
  });

  it("the route id is a positive whole number, or nothing", () => {
    expect(parsePointId("12")).toBe(12);
    expect(parsePointId("0")).toBeUndefined();
    expect(parsePointId("1.5")).toBeUndefined();
    expect(parsePointId("abc")).toBeUndefined();
    expect(parsePointId(undefined)).toBeUndefined();
  });
});
