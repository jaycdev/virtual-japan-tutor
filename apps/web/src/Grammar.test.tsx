import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { afterEach, describe, expect, it } from "vitest";
import { Grammar } from "./Grammar.tsx";

afterEach(cleanup);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Example {
  id: string;
  sentenceJa: string;
  translationEn: string;
  spanStart: number;
  spanEnd: number;
  spanText: string;
  source: string;
}
interface Point {
  id: number;
  jlptLevel: string;
  catalogueNumber: number;
  pattern: string;
  meaning: string;
  variants: string[];
  explanation: string;
  explanationEdited: boolean;
  examples: Example[];
}

const EX1: Example = {
  id: "11111111-1111-1111-1111-111111111111",
  sentenceJa: "宿題を忘れてしまった。",
  translationEn: "I ended up forgetting my homework.",
  spanStart: 5,
  spanEnd: 10,
  spanText: "てしまった",
  source: "ai",
};
const EX2: Example = {
  id: "22222222-2222-2222-2222-222222222222",
  sentenceJa: "電車を乗り遅れてしまった。",
  translationEn: "I ended up missing the train.",
  spanStart: 7,
  spanEnd: 12,
  spanText: "てしまった",
  source: "ai",
};

/** A stateful fake of the grammar API. `requests` records every call's method, path (with query) and body. */
function fakeApi(opts: { providerAssigned?: boolean; reachable?: boolean } = {}) {
  const providerAssigned = opts.providerAssigned ?? true;
  const reachable = opts.reachable ?? true;
  const points: Point[] = [
    {
      id: 1,
      jlptLevel: "N5",
      catalogueNumber: 1,
      pattern: "〜てしまう",
      meaning: "end up doing something",
      variants: ["〜ちまう"],
      explanation: "Form: て-form + しまう. The helper しまう loses its literal 'to put away' sense.",
      explanationEdited: false,
      examples: [EX1],
    },
    {
      id: 2,
      jlptLevel: "N4",
      catalogueNumber: 1,
      pattern: "〜ようになる",
      meaning: "come to do something",
      variants: [],
      explanation: "",
      explanationEdited: false,
      examples: [],
    },
  ];
  let generated = 0;
  const requests: { method: string; path: string; body: unknown }[] = [];

  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const url = new URL(req.url);
      const text = await req.text();
      const body = text ? JSON.parse(text) : {};
      requests.push({ method: req.method, path: url.pathname + url.search, body });
      if (!reachable) throw new TypeError("network down");
      const key = `${req.method} ${url.pathname}`;

      const m = /^\/grammar\/points\/(\d+)(\/examples|\/explanation\/regenerate)?$/.exec(url.pathname);
      if (key === "GET /grammar/points") {
        const level = url.searchParams.get("level");
        const q = url.searchParams.get("q") ?? "";
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const items = points.filter(
          (p) =>
            (!level || p.jlptLevel === level) &&
            (q === "" || p.pattern.includes(q) || p.meaning.toLowerCase().includes(q.toLowerCase())),
        );
        return json(200, {
          items: items.map((p) => ({
            id: p.id,
            jlptLevel: p.jlptLevel,
            catalogueNumber: p.catalogueNumber,
            pattern: p.pattern,
            meaning: p.meaning,
            hasExplanation: p.explanation !== "",
            exampleCount: p.examples.length,
          })),
          total: items.length,
          limit,
          offset,
        });
      }

      if (!m) throw new Error(`unexpected ${key}`);
      const point = points.find((p) => p.id === Number(m[1]));
      if (!point) return json(404, { code: "not_found", message: "no such grammar point" });

      if (req.method === "GET" && !m[2]) return json(200, point);
      if (req.method === "PATCH" && !m[2]) {
        const explanation = String(body.explanation ?? "");
        if (explanation.trim() === "") return json(400, { code: "bad_request", message: "explanation must not be empty" });
        point.explanation = explanation;
        point.explanationEdited = true;
        return json(200, point);
      }
      if (req.method === "POST" && m[2] === "/examples") {
        if (!providerAssigned) {
          return json(409, { code: "no_ai_provider", message: "No AI Provider is assigned to grammar content" });
        }
        generated += 1;
        if (generated === 1) point.examples = [...point.examples, EX2];
        return json(200, {
          generated: generated === 1 ? 2 : 0,
          stored: generated === 1 ? 1 : 0,
          rejected: 1,
          rejections: [{ code: "unknown_word", message: "the span is not a JMdict headword", sentence: "変な文だ。" }],
          note: generated > 1 ? "This point already has enough examples." : undefined,
          examples: point.examples,
        });
      }
      if (req.method === "POST" && m[2] === "/explanation/regenerate") {
        if (!providerAssigned) {
          return json(409, { code: "no_ai_provider", message: "No AI Provider is assigned to grammar content" });
        }
        point.explanation = "A freshly generated explanation.";
        point.explanationEdited = false;
        return json(200, point);
      }
      throw new Error(`unexpected ${key}`);
    },
  });
  return { client, requests };
}

async function renderGrammar(opts?: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(opts);
  render(<Grammar client={api.client} />);
  await screen.findByRole("button", { name: "〜てしまう" });
  return api;
}

async function openPoint(name = "〜てしまう") {
  fireEvent.click(screen.getByRole("button", { name }));
  await screen.findByRole("heading", { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
}

const explanationField = () => screen.getByLabelText("Explanation") as HTMLTextAreaElement;

describe("Grammar", () => {
  it("lists grammar points with level, meaning and example counts", async () => {
    await renderGrammar();
    expect(screen.getByRole("button", { name: "〜ようになる" })).toBeTruthy();
    expect(document.body.textContent).toContain("N5 · end up doing something · 1 examples");
    expect(document.body.textContent).toContain("no explanation yet");
  });

  it("filters the list by level and by search", async () => {
    await renderGrammar();
    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "N4" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "〜てしまう" })).toBeNull());
    expect(screen.getByRole("button", { name: "〜ようになる" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Level"), { target: { value: "all" } });
    await screen.findByRole("button", { name: "〜てしまう" });
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "ようになる" } });
    await waitFor(() => expect(screen.queryByRole("button", { name: "〜てしまう" })).toBeNull());
  });

  it("opens a point and highlights the grammar span inside the example sentence", async () => {
    await renderGrammar();
    await openPoint();
    const mark = screen.getByText("てしまった");
    expect(mark.tagName).toBe("MARK");
    expect(mark.parentElement?.textContent).toContain("宿題を忘れて");
    expect(screen.getByText("I ended up forgetting my homework.")).toBeTruthy();
    expect(explanationField().value).toContain("て-form + しまう");
  });

  it("edits the explanation and saves it", async () => {
    const api = await renderGrammar();
    await openPoint();
    fireEvent.change(explanationField(), { target: { value: "My own explanation." } });
    fireEvent.click(screen.getByRole("button", { name: "Save explanation" }));
    await waitFor(() => expect(explanationField().value).toBe("My own explanation."));
    expect(api.requests.some((r) => r.method === "PATCH" && r.path.startsWith("/grammar/points/1"))).toBe(true);
    expect(await screen.findByText("You have edited this explanation.")).toBeTruthy();
  });

  it("generates examples, showing new sentences and rejected candidates", async () => {
    const api = await renderGrammar();
    await openPoint();
    fireEvent.click(screen.getByRole("button", { name: "Generate examples" }));
    expect(await screen.findByText(/電車を乗り遅れ/)).toBeTruthy();
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Added 1");
    expect(status.textContent).toContain("rejected 1");
    expect(screen.getByText(/the span is not a JMdict headword/)).toBeTruthy();
    expect(api.requests.some((r) => r.method === "POST" && r.path.startsWith("/grammar/points/1/examples"))).toBe(true);
  });

  it("regenerates the explanation and shows the new text", async () => {
    await renderGrammar();
    await openPoint();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate explanation" }));
    await waitFor(() => expect(explanationField().value).toBe("A freshly generated explanation."));
  });

  it("shows the server's message when no AI provider is assigned", async () => {
    await renderGrammar({ providerAssigned: false });
    await openPoint();
    fireEvent.click(screen.getByRole("button", { name: "Generate examples" }));
    expect((await screen.findByRole("alert")).textContent).toContain("No AI Provider is assigned");
  });

  it("goes back to the list", async () => {
    await renderGrammar();
    await openPoint();
    fireEvent.click(screen.getByRole("button", { name: "Back to list" }));
    expect(await screen.findByRole("button", { name: "〜てしまう" })).toBeTruthy();
    expect(screen.queryByText("I ended up forgetting my homework.")).toBeNull();
  });

  it("offers a retry when the server cannot be reached", async () => {
    render(<Grammar client={fakeApi({ reachable: false }).client} />);
    expect(await screen.findByText(/Cannot reach the server/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
