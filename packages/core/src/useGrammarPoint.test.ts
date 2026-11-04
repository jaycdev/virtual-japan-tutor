import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { useGrammarPoint } from "./index.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const point = (over: Record<string, unknown> = {}) => ({
  id: 1,
  jlptLevel: "N5",
  catalogueNumber: 1,
  pattern: "〜てしまう",
  meaning: "end up doing",
  variants: ["〜ちまう"],
  explanation: "Form: て-form + しまう.",
  explanationEdited: false,
  examples: [],
  ...over,
});

function fakeServer(detail: (id: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const url = new URL(req.url);
      calls.push(`${req.method} ${url.pathname}`);
      if (url.pathname === "/grammar/points") return json(200, { items: [], total: 0, limit: 50, offset: 0 });
      const match = /^\/grammar\/points\/(\d+)$/.exec(url.pathname);
      if (!match?.[1]) throw new Error(`unexpected request ${req.method} ${url.pathname}`);
      return detail(match[1]);
    },
  });
  return { client, calls };
}

describe("useGrammarPoint", () => {
  it("reads exactly the one point — no catalogue page along with it", async () => {
    const { client, calls } = fakeServer((id) => json(200, point({ id: Number(id) })));
    const { result } = renderHook(() => useGrammarPoint(client, 7));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const s = result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.point.id).toBe(7);
    expect(calls).toEqual(["GET /grammar/points/7"]);
  });

  it("holds loading while the generating read is in flight", async () => {
    let release: (value: Response) => void = () => {};
    const { client } = fakeServer(
      () => new Promise<Response>((resolve) => (release = resolve)),
    );
    const { result } = renderHook(() => useGrammarPoint(client, 1));
    expect(result.current.state.status).toBe("loading");
    act(() => release(json(200, point())));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("surfaces a failed read with the server's message, and recovers on reload", async () => {
    let up = true;
    const { client, calls } = fakeServer((id) => {
      if (!up) return json(500, { code: "internal", message: "grammar down" });
      return json(200, point({ id: Number(id) }));
    });
    const { result } = renderHook(() => useGrammarPoint(client, 1));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    up = false;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(result.current.state.status === "error" && result.current.state.message).toBe("grammar down");
    up = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(calls.filter((c) => c === "GET /grammar/points/1")).toHaveLength(3);
  });

  it("drops a stale answer when the id changes mid-flight", async () => {
    const releases = new Map<string, (value: Response) => void>();
    const { client } = fakeServer(
      (id) => new Promise<Response>((resolve) => releases.set(id, resolve)),
    );
    const hook = renderHook(({ id }: { id: number }) => useGrammarPoint(client, id), {
      initialProps: { id: 1 },
    });
    await waitFor(() => expect(releases.has("1")).toBe(true));
    hook.rerender({ id: 2 });
    await waitFor(() => expect(releases.has("2")).toBe(true));

    // The first point's late answer lands after the second read started: it
    // must not paint over the current id's state.
    act(() => releases.get("1")!(json(200, point({ id: 1, pattern: "stale" }))));
    await new Promise((r) => setTimeout(r, 0));
    expect(hook.result.current.state.status).toBe("loading");

    act(() => releases.get("2")!(json(200, point({ id: 2, pattern: "current" }))));
    await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
    const s = hook.result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.point.pattern).toBe("current");
  });

  it("stays idle for an id that is not a catalogue point, without asking the server", async () => {
    const { client, calls } = fakeServer(() => json(200, point()));
    const { result } = renderHook(() => useGrammarPoint(client, undefined));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.state.status).toBe("idle");
    expect(calls).toEqual([]);
  });
});
