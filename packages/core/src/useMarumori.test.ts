import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { useMarumori } from "./index.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const status = {
  connected: true,
  connectedAt: "2026-01-01T00:00:00Z",
  lastSync: {
    id: "11111111-1111-4111-8111-111111111111",
    status: "ok" as const,
    startedAt: "2026-01-02T00:00:00Z",
    finishedAt: "2026-01-02T00:00:05Z",
    counts: {
      kanji: 100,
      vocabulary: 500,
      grammarReviews: 10,
      grammarLessons: 20,
      linked: 550,
      unlinked: 50,
      ambiguous: 3,
      new: 42,
      levelChanges: 7,
      disappeared: 1,
      skippedLevelZero: 12,
    },
  },
  counts: {
    kanji: 100,
    vocabulary: 500,
    vocabularyLinkRate: 0.9,
    lastSyncAt: "2026-01-02T00:00:05Z",
  },
};

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

describe("useMarumori", () => {
  it("loads the MaruMori status", async () => {
    const { client } = fakeServer({ "GET /marumori": () => json(200, status) });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    const s = result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.marumori.connected).toBe(true);
    expect(s.marumori.counts?.kanji).toBe(100);
  });

  it("reports a load failure and recovers on reload", async () => {
    let up = false;
    const { client } = fakeServer({
      "GET /marumori": () => {
        if (!up) throw new TypeError("network down");
        return json(200, status);
      },
    });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    up = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("saves the API key once and refreshes the status", async () => {
    let connected = false;
    const { client, calls } = fakeServer({
      "PUT /marumori/key": (call) => {
        if (call.body === undefined || !("apiKey" in (call.body as object))) {
          throw new Error("client sent a body without apiKey");
        }
        connected = true;
        return json(200, status);
      },
      "GET /marumori": () => json(200, connected ? status : { ...status, connected: false, connectedAt: null }),
    });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    if (result.current.state.status === "ready") expect(result.current.state.marumori.connected).toBe(false);

    let res: unknown;
    await act(async () => {
      res = await result.current.saveKey("mm-secret");
    });
    expect(res).toEqual({ ok: true });
    expect(calls.filter((c) => c.method === "PUT")).toEqual([
      { method: "PUT", path: "/marumori/key", body: { apiKey: "mm-secret" } },
    ]);
    await waitFor(() => {
      const s = result.current.state;
      expect(s.status === "ready" && s.marumori.connected).toBe(true);
    });
  });

  it("shows the server's message when saving the key fails", async () => {
    const { client } = fakeServer({
      "PUT /marumori/key": () => json(400, { code: "invalid_key", message: "The API key is not valid." }),
      "GET /marumori": () => json(200, { ...status, connected: false, connectedAt: null }),
    });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    let res: unknown;
    await act(async () => {
      res = await result.current.saveKey("bad");
    });
    expect(res).toEqual({ ok: false, message: "The API key is not valid." });
  });

  it("removes the key", async () => {
    const { client, calls } = fakeServer({
      "DELETE /marumori/key": () => new Response(null, { status: 204 }),
      "GET /marumori": () => json(200, { ...status, connected: false, connectedAt: null, counts: null }),
    });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    let res: unknown;
    await act(async () => {
      res = await result.current.removeKey();
    });
    expect(res).toEqual({ ok: true });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/marumori/key")).toBe(true);
    await waitFor(() => {
      const s = result.current.state;
      expect(s.status === "ready" && s.marumori.connected).toBe(false);
    });
  });

  it("starts a sync and refreshes the status with its outcome", async () => {
    const synced = {
      ...status,
      lastSync: { ...status.lastSync, startedAt: "2026-01-03T00:00:00Z" },
      counts: { ...status.counts, lastSyncAt: "2026-01-03T00:00:04Z" },
    };
    const { client, calls } = fakeServer({
      "POST /marumori/sync": () =>
        json(200, {
          id: "22222222-2222-4222-8222-222222222222",
          status: "ok" as const,
          startedAt: "2026-01-03T00:00:00Z",
          finishedAt: "2026-01-03T00:00:04Z",
          counts: status.lastSync.counts,
        }),
      "GET /marumori": () => {
        const alreadySynced = calls.some((c) => c.method === "POST" && c.path === "/marumori/sync");
        return json(200, alreadySynced ? synced : status);
      },
    });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));

    let outcome: Awaited<ReturnType<typeof result.current.sync>> | undefined;
    await act(async () => {
      outcome = await result.current.sync();
    });
    expect(outcome?.status).toBe("ok");
    expect(calls.some((c) => c.method === "POST" && c.path === "/marumori/sync")).toBe(true);
    await waitFor(() => {
      const s = result.current.state;
      expect(s.status === "ready" && s.marumori.lastSync?.startedAt).toBe("2026-01-03T00:00:00Z");
    });
  });

  it("surfaces a rejected sync (already running) as a message", async () => {
    const { client } = fakeServer({
      "POST /marumori/sync": () => json(409, { code: "sync_running", message: "A Sync is already running" }),
      "GET /marumori": () => json(200, status),
    });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    let outcome: Awaited<ReturnType<typeof result.current.sync>> | undefined;
    await act(async () => {
      outcome = await result.current.sync();
    });
    expect(outcome?.status).toBe("error");
    if (!outcome || outcome.status !== "error") throw new Error("expected an error outcome");
    expect(outcome.message).toBe("A Sync is already running");
  });

  it("loads recent Sync runs on demand", async () => {
    const runs = [
      status.lastSync,
      {
        ...status.lastSync,
        id: "33333333-3333-4333-8333-333333333333",
        status: "failed" as const,
        error: "MaruMori request failed: the API key was rejected",
      },
    ];
    const { client, calls } = fakeServer({
      "GET /marumori": () => json(200, status),
      "GET /marumori/syncs": () => json(200, runs),
    });
    const { result } = renderHook(() => useMarumori(client));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(calls.some((c) => c.path === "/marumori/syncs")).toBe(false);

    act(() => result.current.loadRuns());
    await waitFor(() => expect(result.current.runs.status).toBe("ready"));
    const runsState = result.current.runs;
    if (runsState.status !== "ready") throw new Error("not ready");
    expect(runsState.runs.map((r) => r.status)).toEqual(["ok", "failed"]);
  });
});
