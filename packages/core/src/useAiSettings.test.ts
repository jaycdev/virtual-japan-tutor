import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { useAiSettings } from "./index.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const provider = (id: string, name: string, hasApiKey = true) => ({
  id,
  name,
  baseUrl: "https://api.example.com/v1",
  model: "gpt-x",
  hasApiKey,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});
const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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

const tasks = [
  { task: "story", providerId: A },
  { task: "grammar_content", providerId: null },
];
const base = {
  "GET /ai-providers": () => json(200, [provider(A, "Main"), provider(B, "Local", false)]),
  "GET /ai-tasks": () => json(200, tasks),
};

async function ready(routes: Record<string, (call: Call) => Response | Promise<Response>> = {}) {
  const server = fakeServer({ ...base, ...routes });
  const hook = renderHook(() => useAiSettings(server.client));
  await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
  return { ...server, hook };
}

describe("useAiSettings", () => {
  it("loads providers and task assignments", async () => {
    const { hook } = await ready();
    const s = hook.result.current.state;
    if (s.status !== "ready") throw new Error("not ready");
    expect(s.providers.map((p) => p.name)).toEqual(["Main", "Local"]);
    expect(s.tasks.map((t) => [t.task, t.providerId])).toEqual([
      ["story", A],
      ["grammar_content", null],
    ]);
  });

  it("reports a load failure and recovers on reload", async () => {
    let up = false;
    const { client } = fakeServer({
      "GET /ai-providers": () => {
        if (!up) throw new TypeError("network down");
        return json(200, []);
      },
      "GET /ai-tasks": () => json(200, tasks),
    });
    const { result } = renderHook(() => useAiSettings(client));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    up = true;
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
  });

  it("creates a provider (sending the key once) and refreshes the list", async () => {
    let created = false;
    const { hook, calls } = await ready({
      "POST /ai-providers": () => {
        created = true;
        return json(201, provider("cccccccc-cccc-cccc-cccc-cccccccccccc", "New"));
      },
      "GET /ai-providers": () =>
        json(200, created ? [provider(A, "Main"), provider(B, "Local", false), provider("cccccccc-cccc-cccc-cccc-cccccccccccc", "New")] : [provider(A, "Main"), provider(B, "Local", false)]),
    });
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.create({ name: "New", baseUrl: "http://x", model: "m", apiKey: "sk-1" });
    });
    expect(res).toEqual({ ok: true });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ name: "New", baseUrl: "http://x", model: "m", apiKey: "sk-1" });
    const s = hook.result.current.state;
    expect(s.status === "ready" && s.providers.length).toBe(3);
  });

  it("returns the server's message when an action fails", async () => {
    const { hook } = await ready({
      "POST /ai-providers": () => json(409, { code: "name_taken", message: "A provider with this name already exists" }),
      ["DELETE /ai-providers/" + A]: () => json(409, { code: "provider_in_use", message: "assigned to a task" }),
    });
    let res: unknown;
    await act(async () => {
      res = await hook.result.current.create({ name: "Main", baseUrl: "http://x", model: "m" });
    });
    expect(res).toEqual({ ok: false, message: "A provider with this name already exists" });
    await act(async () => {
      res = await hook.result.current.remove(A);
    });
    expect(res).toEqual({ ok: false, message: "assigned to a task" });
  });

  it("update leaves the key out unless told to change it, and null removes it", async () => {
    const { hook, calls } = await ready({
      ["PATCH /ai-providers/" + A]: () => json(200, provider(A, "Renamed")),
    });
    await act(async () => {
      await hook.result.current.update(A, { name: "Renamed" });
    });
    await act(async () => {
      await hook.result.current.update(A, { apiKey: null });
    });
    const patches = calls.filter((c) => c.method === "PATCH").map((c) => c.body);
    expect(patches[0]).toEqual({ name: "Renamed" });
    expect("apiKey" in (patches[0] as object)).toBe(false);
    expect(patches[1]).toEqual({ apiKey: null });
  });

  it("tests a connection and turns transport failures into a readable result", async () => {
    let down = false;
    const { hook } = await ready({
      ["POST /ai-providers/" + A + "/test"]: () => {
        if (down) throw new TypeError("network down");
        return json(200, { ok: false, latencyMs: 12, message: "Authentication failed (HTTP 401): check the API key." });
      },
    });
    let res: Awaited<ReturnType<typeof hook.result.current.test>> | undefined;
    await act(async () => {
      res = await hook.result.current.test(A);
    });
    expect(res).toMatchObject({ ok: false, message: "Authentication failed (HTTP 401): check the API key." });
    down = true;
    await act(async () => {
      res = await hook.result.current.test(A);
    });
    expect(res).toEqual({ ok: false, latencyMs: 0, message: "Cannot reach the server" });
  });

  it("assigns a provider to a task, and clears it with null", async () => {
    const { hook, calls } = await ready({
      "PUT /ai-tasks/grammar_content": () => json(200, { task: "grammar_content", providerId: B }),
      "DELETE /ai-tasks/story": () => json(200, { task: "story", providerId: null }),
    });
    await act(async () => {
      await hook.result.current.assign("grammar_content", B);
    });
    await act(async () => {
      await hook.result.current.assign("story", null);
    });
    expect(calls.find((c) => c.method === "PUT")?.body).toEqual({ providerId: B });
    expect(calls.some((c) => c.method === "DELETE" && c.path === "/ai-tasks/story")).toBe(true);
  });
});
