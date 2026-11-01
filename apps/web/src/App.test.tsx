import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { localStorageTokenStorage } from "./tokenStorage.ts";

const alice = { id: "11111111-1111-1111-1111-111111111111", username: "alice" };

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A fake API: valid credentials are alice / right-password, valid token is tok-1. */
function fakeApi() {
  const calls: string[] = [];
  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      calls.push(`${req.method} ${path}`);
      const authed = req.headers.get("Authorization") === "Bearer tok-1";
      switch (`${req.method} ${path}`) {
        case "GET /health":
          return json(200, { status: "ok", database: "connected" });
        case "GET /me":
          return authed ? json(200, alice) : json(401, { code: "unauthorized", message: "no" });
        case "POST /auth/login": {
          const body = (await req.json()) as { username: string; password: string };
          return body.username === "alice" && body.password === "right-password"
            ? json(200, { token: "tok-1", expires_at: "2030-01-01T00:00:00Z", user: alice })
            : json(401, { code: "invalid_credentials", message: "Invalid username or password" });
        }
        case "POST /auth/logout":
          return authed ? new Response(null, { status: 204 }) : json(401, { code: "unauthorized", message: "no" });
        case "GET /ai-providers":
          return authed ? json(200, []) : json(401, { code: "unauthorized", message: "no" });
        case "GET /ai-tasks":
          return authed
            ? json(200, [
                { task: "story", providerId: null },
                { task: "grammar_content", providerId: null },
              ])
            : json(401, { code: "unauthorized", message: "no" });
        case "GET /marumori":
          return authed
            ? json(200, { connected: false, connectedAt: null, lastSync: null, counts: null })
            : json(401, { code: "unauthorized", message: "no" });
        default:
          throw new Error(`unexpected ${req.method} ${path}`);
      }
    },
  });
  return { client, calls };
}

function renderApp() {
  const { client, calls } = fakeApi();
  const storage = localStorageTokenStorage();
  render(<App client={client} storage={storage} />);
  return { calls };
}

function signIn(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
}

describe("App", () => {
  it("shows the login screen when there is no stored session", async () => {
    renderApp();
    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it("logs in, shows who is signed in and the server health, and remembers the token", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Log in" });

    signIn("alice", "right-password");

    expect(await screen.findByText("Signed in as alice")).toBeTruthy();
    expect(await screen.findByText("Server: ok, database: connected")).toBeTruthy();
    expect(localStorage.getItem("vjt.token")).toBe("tok-1");
  });

  it("shows an error and stays on the login screen after wrong credentials", async () => {
    renderApp();
    await screen.findByRole("button", { name: "Log in" });

    signIn("alice", "nope");

    expect((await screen.findByRole("alert")).textContent).toBe("Invalid username or password");
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(localStorage.getItem("vjt.token")).toBeNull();
  });

  it("goes straight to the app when a valid token is already stored", async () => {
    localStorage.setItem("vjt.token", "tok-1");
    renderApp();
    expect(await screen.findByText("Signed in as alice")).toBeTruthy();
  });

  it("returns to the login screen when the stored token is rejected (401)", async () => {
    localStorage.setItem("vjt.token", "expired");
    renderApp();
    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
    expect(localStorage.getItem("vjt.token")).toBeNull();
  });

  it("logs out: calls the API, forgets the token and shows the login screen", async () => {
    localStorage.setItem("vjt.token", "tok-1");
    const { calls } = renderApp();
    await screen.findByText("Signed in as alice");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("button", { name: "Log in" })).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("vjt.token")).toBeNull());
    expect(calls).toContain("POST /auth/logout");
  });

  it("navigates between Home and Settings from the signed-in shell", async () => {
    localStorage.setItem("vjt.token", "tok-1");
    renderApp();
    await screen.findByText("Signed in as alice");
    expect(screen.queryByRole("heading", { name: "AI providers" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { name: "AI providers" })).toBeTruthy();
    expect(screen.getByLabelText("Story generation")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(await screen.findByText("Signed in as alice")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "AI providers" })).toBeNull();
  });

  it("offers a retry instead of logging out when the server is unreachable", async () => {
    localStorage.setItem("vjt.token", "tok-1");
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async () => {
        throw new TypeError("network down");
      },
    });
    render(<App client={client} storage={localStorageTokenStorage()} />);
    expect(await screen.findByText(/Cannot reach server/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(localStorage.getItem("vjt.token")).toBe("tok-1");
  });
});
