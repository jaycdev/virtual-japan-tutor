import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { useGrammar } from "./index.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

function fakeServer(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const url = new URL(req.url);
      const text = await req.text();
      const call: Call = {
        method: req.method,
        path: url.pathname,
        query: url.searchParams,
        body: text ? JSON.parse(text) : undefined,
      };
      calls.push(call);
      const route = routes[`${req.method} ${url.pathname}`];
      if (!route) throw new Error(`unexpected request ${req.method} ${url.pathname}`);
      return route(call);
    },
  });
  return { client, calls };
}

const summary = (id: number, level: "N5" | "N4", pattern: string, meaning: string, hasExplanation: boolean, exampleCount: number) => ({
  id,
  jlptLevel: level,
  catalogueNumber: id,
  pattern,
  meaning,
  hasExplanation,
  exampleCount,
});
const pageOf = (items: unknown[], query: URLSearchParams) => ({
  items,
  total: items.length,
  limit: Number(query.get("limit") ?? 50),
  offset: Number(query.get("offset") ?? 0),
});
const example = {
  id: "11111111-1111-1111-1111-111111111111",
  sentenceJa: "宿題を忘れてしまった。",
  translationEn: "I ended up forgetting my homework.",
  spanStart: 5,
  spanEnd: 10,
  spanText: "てしまった",
  source: "ai",
};
const point = (over: Record<string, unknown> = {}) => ({
  id: 1,
  jlptLevel: "N5",
  catalogueNumber: 1,
  pattern: "〜てしまう",
  meaning: "end up doing",
  variants: ["〜ちまう"],
  explanation: "Form: て-form + しまう.",
  explanationEdited: false,
  examples: [example],
  ...over,
});

const list = () =>
  json(200, pageOf([summary(1, "N5", "〜てしまう", "end up doing", true, 1), summary(2, "N4", "〜ようになる", "come to do", false, 0)], new URLSearchParams()));

async function ready(routes: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  const server = fakeServer({ "GET /grammar/points": list, ...routes });
  const hook = renderHook(() => useGrammar(server.client));
  await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
  return { ...server, hook };
}

describe("useGrammar", () => {
  it("loads the first page of grammar points with catalogue order and content status", async () => {
    const { hook, calls } = await ready();
    const s = hook.result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.page.items.map((p) => p.pattern)).toEqual(["〜てしまう", "〜ようになる"]);
    expect(s.page.total).toBe(2);
    const get = calls.find((c) => c.method === "GET" && c.path === "/grammar/points");
    expect(get?.query.get("level")).toBeNull(); // "all" is not sent
    expect(get?.query.get("q")).toBeNull(); // empty search is not sent
  });

  it("filters by level and search, resetting to the first page", async () => {
    const { hook, calls } = await ready({
      "GET /grammar/points": (c) =>
        json(200, pageOf(c.query.get("level") === "N4" ? [summary(2, "N4", "〜ようになる", "come to do", false, 0)] : [], c.query)),
    });
    act(() => hook.result.current.setLevel("N4"));
    await waitFor(() => {
      const s = hook.result.current.state;
      expect(s.status === "ready" && s.page.items.length).toBe(1);
    });
    act(() => hook.result.current.setQuery("なる"));
    await waitFor(() => expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThanOrEqual(2));
    const lastGet = calls.toReversed().find((c) => c.path === "/grammar/points");
    expect(lastGet?.query.get("level")).toBe("N4");
    expect(lastGet?.query.get("q")).toBe("なる");
  });

  it("pages through the list with offset", async () => {
    const { hook, calls } = await ready();
    act(() => hook.result.current.setOffset(50));
    await waitFor(() => {
      const lastGet = calls.toReversed().find((c) => c.path === "/grammar/points");
      expect(lastGet?.query.get("offset")).toBe("50");
    });
  });

  it("reports a load failure and recovers on reload", async () => {
    let up = false;
    const { client } = fakeServer({
      "GET /grammar/points": () => {
        if (!up) throw new TypeError("network down");
        return list();
      },
    });
    const { result } = renderHook(() => useGrammar(client));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.status === "error" && result.current.state.message).toBe("Cannot reach the server");
    up = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("opens a point and shows its explanation and examples", async () => {
    const { hook, calls } = await ready({ "GET /grammar/points/1": () => json(200, point()) });
    act(() => hook.result.current.open(1));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("ready"));
    const d = hook.result.current.detail;
    if (d.status !== "ready") throw new Error("not ready");
    expect(d.point.explanation).toContain("て-form");
    expect(d.point.examples[0]?.spanText).toBe("てしまった");
    expect(calls.some((c) => c.method === "GET" && c.path === "/grammar/points/1")).toBe(true);
  });

  it("surfaces a detail fetch failure", async () => {
    const { hook } = await ready({ "GET /grammar/points/9": () => json(404, { code: "not_found", message: "no such grammar point" }) });
    act(() => hook.result.current.open(9));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("error"));
    const d = hook.result.current.detail;
    expect(d.status === "error" && d.message).toBe("no such grammar point");
  });

  it("closes the detail again", async () => {
    const { hook } = await ready({ "GET /grammar/points/1": () => json(200, point()) });
    act(() => hook.result.current.open(1));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("ready"));
    act(() => hook.result.current.close());
    expect(hook.result.current.detail.status).toBe("idle");
  });

  it("saves an edited explanation and shows the server's copy", async () => {
    const saved = point({ explanation: "My own explanation.", explanationEdited: true });
    const { hook, calls } = await ready({
      "GET /grammar/points/1": () => json(200, point()),
      "PATCH /grammar/points/1": () => json(200, saved),
    });
    act(() => hook.result.current.open(1));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("ready"));
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.saveExplanation(1, "My own explanation.");
    });
    expect(res).toEqual({ ok: true });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.body).toEqual({ explanation: "My own explanation." });
    const d = hook.result.current.detail;
    expect(d.status === "ready" && d.point.explanation).toBe("My own explanation.");
    expect(d.status === "ready" && d.point.explanationEdited).toBe(true);
  });

  it("rejects saving an empty explanation with the server's message", async () => {
    const { hook } = await ready({
      "GET /grammar/points/1": () => json(200, point()),
      "PATCH /grammar/points/1": () => json(400, { code: "bad_request", message: "explanation must not be empty" }),
    });
    act(() => hook.result.current.open(1));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("ready"));
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.saveExplanation(1, "   ");
    });
    expect(res).toEqual({ ok: false, message: "explanation must not be empty" });
  });

  it("generates examples, keeps every stored example, and reports rejections", async () => {
    const fresh = { ...example, id: "22222222-2222-2222-2222-222222222222", sentenceJa: "電車を乗り遅れてしまった。" };
    const result = {
      generated: 2,
      stored: 1,
      rejected: 1,
      rejections: [{ code: "unknown_word", message: "span token is not a JMdict headword", sentence: "変な文だ。" }],
      examples: [example, fresh],
    };
    const { hook, calls } = await ready({
      "GET /grammar/points/1": () => json(200, point()),
      "POST /grammar/points/1/examples": () => json(200, result),
    });
    act(() => hook.result.current.open(1));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("ready"));
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.generateExamples(1, 5);
    });
    expect(res).toEqual({ ok: true, result });
    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/grammar/points/1/examples");
    expect(post?.body).toEqual({ count: 5 });
    const d = hook.result.current.detail;
    expect(d.status === "ready" && d.point.examples.length).toBe(2);
  });

  it("turns the missing-provider 409 into an action failure with the server's message", async () => {
    const { hook } = await ready({
      "GET /grammar/points/1": () => json(200, point({ explanation: "", examples: [] })),
      "POST /grammar/points/1/examples": () =>
        json(409, { code: "no_ai_provider", message: "No AI Provider is assigned to grammar content" }),
    });
    act(() => hook.result.current.open(1));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("ready"));
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.generateExamples(1);
    });
    expect(res).toEqual({ ok: false, message: "No AI Provider is assigned to grammar content" });
  });

  it("regenerates the explanation and shows the new one", async () => {
    const regenerated = point({ explanation: "A fresh generated explanation.", explanationEdited: false });
    const { hook, calls } = await ready({
      "GET /grammar/points/1": () => json(200, point()),
      "POST /grammar/points/1/explanation/regenerate": () => json(200, regenerated),
    });
    act(() => hook.result.current.open(1));
    await waitFor(() => expect(hook.result.current.detail.status).toBe("ready"));
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.regenerateExplanation(1);
    });
    expect(res).toEqual({ ok: true });
    expect(calls.some((c) => c.method === "POST" && c.path === "/grammar/points/1/explanation/regenerate")).toBe(true);
    const d = hook.result.current.detail;
    expect(d.status === "ready" && d.point.explanation).toBe("A fresh generated explanation.");
  });
});
