import { act, renderHook, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { describe, expect, it } from "vitest";
import { memoryTokenStorage, useAuth } from "./index.ts";

const alice = { id: "11111111-1111-1111-1111-111111111111", username: "alice" };

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

interface Call {
  method: string;
  path: string;
  authorization: string | null;
  body: unknown;
}

/** A fake server: `routes` maps "METHOD /path" to a handler. Records every call. */
function fakeServer(routes: Record<string, (call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      const text = await req.text();
      const call: Call = {
        method: req.method,
        path,
        authorization: req.headers.get("Authorization"),
        body: text ? JSON.parse(text) : undefined,
      };
      calls.push(call);
      const route = routes[`${req.method} ${path}`];
      if (!route) throw new Error(`unexpected request ${req.method} ${path}`);
      return route(call);
    },
  });
  return { client, calls };
}

const meOk = (call: Call) => (call.authorization === "Bearer tok-1" ? json(200, alice) : json(401, unauth));
const unauth = { code: "unauthorized", message: "Missing, invalid or expired session token" };

describe("useAuth: restoring a session", () => {
  it("is signed out, without touching the network, when no token is stored", async () => {
    const { client, calls } = fakeServer({});
    const storage = memoryTokenStorage();
    const { result } = renderHook(() => useAuth(client, storage));
    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "signedOut" }));
    expect(calls).toEqual([]);
  });

  it("signs in with the stored token and sends it as a bearer token", async () => {
    const { client, calls } = fakeServer({ "GET /me": meOk });
    const storage = memoryTokenStorage("tok-1");
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state).toEqual({ status: "signedIn", user: alice }));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.authorization).toBe("Bearer tok-1");
  });

  it("drops a rejected stored token and returns to the login screen", async () => {
    const storage = memoryTokenStorage("expired");
    const { client } = fakeServer({ "GET /me": meOk });
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state).toEqual({ status: "signedOut" }));
    expect(await storage.get()).toBeNull();
  });

  it("keeps the token and offers a retry when the server cannot be reached", async () => {
    const storage = memoryTokenStorage("tok-1");
    let up = false;
    const { client } = fakeServer({
      "GET /me": (call) => {
        if (!up) throw new TypeError("network down");
        return meOk(call);
      },
    });
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    expect(await storage.get()).toBe("tok-1");

    up = true;
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.state).toEqual({ status: "signedIn", user: alice }));
  });
});

describe("useAuth: login", () => {
  const loginRoute = (call: Call) => {
    const body = call.body as { username: string; password: string };
    return body.username === "alice" && body.password === "right-password"
      ? json(200, { token: "tok-1", expires_at: "2030-01-01T00:00:00Z", user: alice })
      : json(401, { code: "invalid_credentials", message: "Invalid username or password" });
  };

  it("stores the token, signs in and authenticates later requests", async () => {
    const storage = memoryTokenStorage();
    const { client, calls } = fakeServer({ "POST /auth/login": loginRoute, "GET /me": meOk });
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("signedOut"));

    await act(() => result.current.login("alice", "right-password"));

    expect(result.current.state).toEqual({ status: "signedIn", user: alice });
    expect(await storage.get()).toBe("tok-1");
    expect(calls[0]?.authorization).toBeNull(); // the login request itself carries no token

    await client.GET("/me");
    expect(calls.at(-1)?.authorization).toBe("Bearer tok-1");
  });

  it("shows the server's message on bad credentials and stores nothing", async () => {
    const storage = memoryTokenStorage();
    const { client } = fakeServer({ "POST /auth/login": loginRoute });
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("signedOut"));

    await act(() => result.current.login("alice", "wrong"));

    expect(result.current.state).toEqual({ status: "signedOut", error: "Invalid username or password" });
    expect(await storage.get()).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("tells the user how long to wait when rate limited", async () => {
    const { client } = fakeServer({
      "POST /auth/login": () =>
        json(429, { code: "too_many_attempts", message: "Too many failed attempts" }, { "Retry-After": "30" }),
    });
    const storage = memoryTokenStorage();
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("signedOut"));

    await act(() => result.current.login("alice", "x"));

    expect(result.current.state).toMatchObject({ status: "signedOut" });
    expect((result.current.state as { error: string }).error).toContain("30");
  });

  it("reports an unreachable server as a login error", async () => {
    const { client } = fakeServer({
      "POST /auth/login": () => {
        throw new TypeError("network down");
      },
    });
    const storage = memoryTokenStorage();
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("signedOut"));

    await act(() => result.current.login("alice", "x"));

    expect(result.current.state).toMatchObject({ status: "signedOut" });
    expect((result.current.state as { error: string }).error).toMatch(/reach/i);
  });
});

describe("useAuth: logout and expiry", () => {
  it("logs out on the server with the token, clears it and signs out", async () => {
    const storage = memoryTokenStorage("tok-1");
    const { client, calls } = fakeServer({
      "GET /me": meOk,
      "POST /auth/logout": () => new Response(null, { status: 204 }),
    });
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("signedIn"));

    await act(() => result.current.logout());

    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/auth/logout", authorization: "Bearer tok-1" });
    expect(await storage.get()).toBeNull();
    expect(result.current.state).toEqual({ status: "signedOut" });
  });

  it("signs out locally even if the server cannot be reached", async () => {
    const storage = memoryTokenStorage("tok-1");
    const { client } = fakeServer({
      "GET /me": meOk,
      "POST /auth/logout": () => {
        throw new TypeError("network down");
      },
    });
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("signedIn"));

    await act(() => result.current.logout());

    expect(await storage.get()).toBeNull();
    expect(result.current.state).toEqual({ status: "signedOut" });
  });

  it("returns to the login screen when any later request is answered 401", async () => {
    const storage = memoryTokenStorage("tok-1");
    let expired = false;
    const { client } = fakeServer({
      "GET /me": (call) => (expired ? json(401, unauth) : meOk(call)),
    });
    const { result } = renderHook(() => useAuth(client, storage));
    await waitFor(() => expect(result.current.state.status).toBe("signedIn"));

    expired = true;
    await act(async () => {
      await client.GET("/me");
    });

    await waitFor(() => expect(result.current.state).toEqual({ status: "signedOut" }));
    expect(await storage.get()).toBeNull();
  });
});
