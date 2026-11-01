import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { useGrammarReview, useStartingLevel } from "./index.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function fakeServer(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      const text = await req.text();
      const call: Call = { method: req.method, path, body: text ? JSON.parse(text) : undefined };
      calls.push(call);
      const route = routes[`${req.method} ${path}`];
      if (!route) throw new Error(`unexpected request ${req.method} ${path}`);
      return route(call);
    },
  });
  return { client, calls };
}

const unset = { configured: false, level: null };

describe("useStartingLevel", () => {
  it("loads an unconfigured Starting Level", async () => {
    const { client } = fakeServer({ "GET /starting-level": () => json(200, unset) });
    const { result } = renderHook(() => useStartingLevel(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const s = result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.level.configured).toBe(false);
    expect(s.level.level).toBeNull();
  });

  it("reports a load failure and recovers on reload", async () => {
    let up = false;
    const { client } = fakeServer({
      "GET /starting-level": () => {
        if (!up) throw new TypeError("network down");
        return json(200, { configured: true, level: "N4" });
      },
    });
    const { result } = renderHook(() => useStartingLevel(client));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    up = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("sets the level and shows the seeded counts from the response", async () => {
    const seeded = { configured: true, level: "N4" as const, added: 120, removed: 0 };
    const { client, calls } = fakeServer({
      "GET /starting-level": () => json(200, unset),
      "PUT /starting-level": () => json(200, seeded),
    });
    const { result } = renderHook(() => useStartingLevel(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let outcome: Awaited<ReturnType<typeof result.current.setLevel>> | undefined;
    await act(async () => {
      outcome = await result.current.setLevel("N4");
    });
    expect(calls.filter((c) => c.method === "PUT")).toEqual([
      { method: "PUT", path: "/starting-level", body: { level: "N4" } },
    ]);
    if (!outcome || "status" in outcome) throw new Error("expected the new status");
    expect(outcome.configured).toBe(true);
    expect(outcome.added).toBe(120);
    await waitFor(() => {
      const s = result.current.state;
      expect(s.status === "ready" && s.level.configured && s.level.level === "N4").toBe(true);
    });
  });

  it("surfaces the server's message for a rejected level", async () => {
    const { client } = fakeServer({
      "GET /starting-level": () => json(200, unset),
      "PUT /starting-level": () => json(400, { code: "invalid_level", message: "level must be one of N5, N4, N3, N2, N1" }),
    });
    const { result } = renderHook(() => useStartingLevel(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    let outcome: Awaited<ReturnType<typeof result.current.setLevel>> | undefined;
    await act(async () => {
      outcome = await result.current.setLevel("N7" as "N5");
    });
    if (!outcome || !("status" in outcome)) throw new Error("expected an error outcome");
    expect(outcome.message).toContain("level must be one of");
  });
});

describe("useGrammarReview", () => {
  it("loads the flagged observations", async () => {
    const items = [
      { marumoriId: "Grammar/904", pattern: "ものではない", flagged: true },
      { marumoriId: "Grammar/6578", pattern: "〜ちゃいけない", jlptLevel: "N5" as const, matchedPointId: 12, flagged: true },
    ];
    const { client } = fakeServer({ "GET /grammar/review": () => json(200, items) });
    const { result } = renderHook(() => useGrammarReview(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const s = result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.items.map((i) => i.marumoriId)).toEqual(["Grammar/904", "Grammar/6578"]);
    const matched = s.items.find((i) => i.marumoriId === "Grammar/6578");
    expect(matched?.matchedPointId).toBe(12);
    expect(matched?.jlptLevel).toBe("N5");
  });

  it("reports a load failure and recovers on reload", async () => {
    let up = false;
    const { client } = fakeServer({
      "GET /grammar/review": () => {
        if (!up) throw new TypeError("network down");
        return json(200, []);
      },
    });
    const { result } = renderHook(() => useGrammarReview(client));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    up = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const s = result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.items).toEqual([]);
  });
});
