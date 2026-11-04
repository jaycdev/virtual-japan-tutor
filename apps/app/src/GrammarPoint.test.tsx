import { createApiClient } from "@vjt/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GrammarPoint } from "./GrammarPoint.tsx";

/**
 * Grammar Point detail (#49). The generating wait is the read itself: the
 * server writes a missing explanation and validates examples synchronously
 * inside GET /grammar/points/{id}, so the "generating → ready" case is a held
 * response landing a moment later, exactly like Today's held settings read.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const DETAIL = {
  id: 12,
  jlptLevel: "N4",
  catalogueNumber: 12,
  pattern: "〜てしまう",
  meaning: "end up doing something",
  variants: ["〜ちまう"],
  explanation:
    "Form: **て-form** + しまう. The helper softens the main verb.\n\n- Something completed, often with regret\n- An unintended result",
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

type Fixture = {
  detailStatus: number;
  detail: unknown;
  /** Resolve the detail read only when a test says so (generating→ready). */
  holdDetail?: boolean;
};

describe("Grammar point detail", () => {
  let fixture: Fixture;
  let fetchMock: ReturnType<typeof vi.fn>;
  let gets: string[];
  let releaseDetail: ((value: Response) => void) | null;

  beforeEach(() => {
    fixture = { detailStatus: 200, detail: DETAIL, holdDetail: false };
    gets = [];
    releaseDetail = null;
    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const request = new Request(input);
      const url = new URL(request.url);
      const path = url.pathname;
      gets.push(`${request.method} ${path}`);

      const match = /^\/grammar\/points\/(\d+)$/.exec(path);
      if (!match) return jsonResponse({ message: `stub: unexpected GET ${path}` }, 500);
      if (Number(match[1]) !== DETAIL.id) return jsonResponse({ message: "no such grammar point" }, 404);

      if (fixture.holdDetail) return new Promise<Response>((resolve) => (releaseDetail = resolve));
      if (fixture.detailStatus !== 200) return jsonResponse({ message: "grammar down" }, fixture.detailStatus);
      return jsonResponse(fixture.detail);
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderPoint(pointId: number | undefined, onBack = vi.fn()) {
    const client = createApiClient({ baseUrl: "http://localhost", fetch: fetchMock as unknown as typeof fetch });
    render(<GrammarPoint client={client} pointId={pointId} onBack={onBack} />);
    return { client, onBack };
  }

  it("shows the pattern, level, number, meaning and variants in the header", async () => {
    renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByRole("heading", { name: "〜てしまう" })).toBeTruthy());
    expect(screen.getByText("N4")).toBeTruthy();
    expect(screen.getByText("#12")).toBeTruthy();
    expect(screen.getByText("end up doing something")).toBeTruthy();
    expect(screen.getByText("Also written 〜ちまう")).toBeTruthy();
  });

  it("reads only its own point — no catalogue page rides along (#49 review S4)", async () => {
    renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByRole("heading", { name: "〜てしまう" })).toBeTruthy());
    expect(gets.filter((call) => call === "GET /grammar/points")).toHaveLength(0);
    expect(gets.filter((call) => call === `GET /grammar/points/${DETAIL.id}`)).toHaveLength(1);
  });

  it("reads the explanation as prose and bullets, not raw markdown", async () => {
    renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByText("Explanation")).toBeTruthy());
    // **bold** renders as a bold run, "- " lines as bullets.
    expect(screen.getByText("て-form")).toBeTruthy();
    expect(screen.getByText("• Something completed, often with regret")).toBeTruthy();
    expect(screen.queryByText(/\*\*/)).toBeNull();
    expect(screen.queryByText(/^- /m)).toBeNull();
  });

  it("marks the Grammar Span inside each example sentence", async () => {
    renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByText("Example sentences")).toBeTruthy());
    // The sentence runs in order — head, the span, the tail — plus the gloss.
    // The head+tail share one Text (the span is a nested run inside it), so the
    // head is matched as a substring of that line.
    expect(screen.getByText("宿題を忘れ", { exact: false })).toBeTruthy();
    expect(screen.getByText("てしまった")).toBeTruthy();
    expect(screen.getByText("I ended up forgetting my homework.")).toBeTruthy();
  });

  it("says the page is being prepared until the first read lands", async () => {
    fixture.holdDetail = true;
    renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByTestId("grammar-detail-skeleton")).toBeTruthy());
    expect(screen.getByText(/Preparing this page/)).toBeTruthy();
    expect(screen.queryByText("Explanation")).toBeNull();

    expect(releaseDetail).not.toBeNull();
    (releaseDetail as unknown as (value: Response) => void)(jsonResponse(DETAIL));
    await waitFor(() => expect(screen.getByRole("heading", { name: "〜てしまう" })).toBeTruthy());
    expect(screen.queryByTestId("grammar-detail-skeleton")).toBeNull();
    expect(screen.queryByText(/Preparing this page/)).toBeNull();
  });

  it("reports a failed read with Retry in place", async () => {
    fixture.detailStatus = 500;
    renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByText(/Cannot load this grammar point: grammar down/)).toBeTruthy());

    const before = gets.filter((call) => call.includes(`/grammar/points/${DETAIL.id}`)).length;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(gets.filter((call) => call.includes(`/grammar/points/${DETAIL.id}`)).length).toBeGreaterThan(before),
    );
  });

  it("admits a failed generation and offers Reload, instead of claiming the page was never opened (#49 review S1)", async () => {
    fixture.detail = { ...DETAIL, explanation: "", explanationEdited: false, examples: [] };
    renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByText(/could not generate this explanation/)).toBeTruthy());
    expect(screen.getByText(/Check the AI Provider for grammar content in Settings/)).toBeTruthy();
    expect(screen.queryByText(/first time this page is opened/)).toBeNull();
    expect(screen.getByText("No validated examples yet.")).toBeTruthy();

    // Reload re-reads the point — the server retries generation inside the GET.
    const before = gets.filter((call) => call === `GET /grammar/points/${DETAIL.id}`).length;
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() =>
      expect(gets.filter((call) => call === `GET /grammar/points/${DETAIL.id}`).length).toBeGreaterThan(before),
    );
  });

  it("goes back to the catalogue through the host’s control", async () => {
    const { onBack } = renderPoint(DETAIL.id);
    await waitFor(() => expect(screen.getByText("Explanation")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Back to grammar" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("names a route id that is not a catalogue point, without asking the server", async () => {
    renderPoint(undefined);
    await waitFor(() => expect(screen.getByText("This is not a grammar point from the catalogue.")).toBeTruthy());
    expect(gets.some((call) => call.startsWith("GET /grammar/points/"))).toBe(false);
  });
});
