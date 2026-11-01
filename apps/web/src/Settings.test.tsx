import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { afterEach, describe, expect, it } from "vitest";
import { Settings } from "./Settings.tsx";

afterEach(cleanup);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

interface P {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const mk = (id: string, name: string, hasApiKey: boolean, model = "gpt-x"): P => ({
  id,
  name,
  baseUrl: "https://api.example.com/v1",
  model,
  hasApiKey,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

interface Maru {
  connected: boolean;
  connectedAt: string | null;
  lastSync: Record<string, unknown> | null;
  counts: { kanji: number; vocabulary: number; vocabularyLinkRate: number; lastSyncAt: string | null } | null;
  runs: Record<string, unknown>[];
}

const syncRun = (id: string, status: "ok" | "failed", extra: Record<string, unknown> = {}) => ({
  id,
  status,
  startedAt: "2026-01-05T10:00:00Z",
  finishedAt: "2026-01-05T10:00:04Z",
  ...extra,
});
const syncCounts = {
  kanji: 120,
  vocabulary: 340,
  grammarReviews: 30,
  grammarLessons: 15,
  linked: 300,
  unlinked: 40,
  ambiguous: 4,
  new: 42,
  levelChanges: 7,
  disappeared: 1,
  skippedLevelZero: 5,
};

/** A stateful fake of the AI Provider and MaruMori APIs. `requests` records every call's method, path and body. */
function fakeApi(
  opts: {
    testResult?: unknown;
    rejectKey?: boolean;
    syncOutcome?: ReturnType<typeof syncRun>;
    maruMori?: Partial<Maru>;
  } = {},
) {
  const providers: P[] = [mk(A, "OpenAI", true), mk(B, "Local Ollama", false, "llama3")];
  const tasks: Record<string, string | null> = { story: A, grammar_content: null };
  const requests: { method: string; path: string; body: unknown }[] = [];
  const taskList = () => Object.entries(tasks).map(([task, providerId]) => ({ task, providerId }));
  const maru: Maru = {
    connected: false,
    connectedAt: null,
    lastSync: null,
    counts: null,
    runs: [],
    ...opts.maruMori,
  };
  const maruStatus = () => ({
    connected: maru.connected,
    connectedAt: maru.connectedAt,
    lastSync: maru.lastSync,
    counts: maru.counts,
  });

  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const path = new URL(req.url).pathname;
      const text = await req.text();
      const body = text ? JSON.parse(text) : undefined;
      requests.push({ method: req.method, path, body });
      const key = `${req.method} ${path}`;
      if (key === "GET /ai-providers") return json(200, providers);
      if (key === "GET /ai-tasks") return json(200, taskList());
      if (key === "POST /ai-providers") {
        if (providers.some((p) => p.name.toLowerCase() === String(body.name).toLowerCase())) {
          return json(409, { code: "name_taken", message: "A provider with this name already exists" });
        }
        const p = mk(`cccccccc-cccc-cccc-cccc-${String(providers.length).padStart(12, "0")}`, body.name, !!body.apiKey, body.model);
        p.baseUrl = body.baseUrl;
        providers.push(p);
        return json(201, p);
      }
      const m = /^\/ai-providers\/([^/]+)(\/test)?$/.exec(path);
      if (m) {
        const p = providers.find((x) => x.id === m[1]);
        if (!p) return json(404, { code: "not_found", message: "AI provider not found" });
        if (m[2] && req.method === "POST") {
          return json(200, opts.testResult ?? { ok: true, latencyMs: 42, message: "Connected: the model answered in 42 ms.", structuredOutput: "json_schema" });
        }
        if (req.method === "PATCH") {
          if (body.name !== undefined) p.name = body.name;
          if (body.baseUrl !== undefined) p.baseUrl = body.baseUrl;
          if (body.model !== undefined) p.model = body.model;
          if ("apiKey" in body) p.hasApiKey = !!body.apiKey;
          return json(200, p);
        }
        if (req.method === "DELETE") {
          if (Object.values(tasks).includes(p.id)) {
            return json(409, { code: "provider_in_use", message: "This provider is assigned to a task; choose another provider for the task first" });
          }
          providers.splice(providers.indexOf(p), 1);
          return new Response(null, { status: 204 });
        }
      }
      const t = /^\/ai-tasks\/([^/]+)$/.exec(path);
      if (t && req.method === "PUT") {
        tasks[t[1]!] = body.providerId;
        return json(200, { task: t[1], providerId: body.providerId });
      }
      if (t && req.method === "DELETE") {
        tasks[t[1]!] = null;
        return json(200, { task: t[1], providerId: null });
      }
      if (key === "GET /marumori") return json(200, maruStatus());
      if (key === "PUT /marumori/key") {
        if (opts.rejectKey) return json(400, { code: "invalid_key", message: "The MaruMori API key was rejected." });
        maru.connected = true;
        maru.connectedAt = "2026-01-05T09:00:00Z";
        return json(200, maruStatus());
      }
      if (key === "DELETE /marumori/key") {
        maru.connected = false;
        maru.connectedAt = null;
        return new Response(null, { status: 204 });
      }
      if (key === "POST /marumori/sync") {
        if (!maru.connected) return json(400, { code: "no_key", message: "Add your MaruMori API key first" });
        const run = opts.syncOutcome ?? syncRun("55555555-5555-4555-8555-555555555555", "ok", { counts: syncCounts });
        maru.lastSync = run;
        maru.runs = [run, ...maru.runs];
        if (maru.counts && run.status === "ok") maru.counts = { ...maru.counts, lastSyncAt: run.finishedAt };
        return json(200, run);
      }
      if (key === "GET /marumori/syncs") return json(200, maru.runs);
      throw new Error(`unexpected ${key}`);
    },
  });
  return { client, requests, providers, tasks, maru };
}

async function renderSettings(opts?: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(opts);
  render(<Settings client={api.client} />);
  await waitFor(() => row("OpenAI"));
  return api;
}

// A provider row is the <li> whose heading is `name`. (Provider names also appear as <option>s in
// the task selectors, so plain getByText(name) would be ambiguous.)
const maybeRow = (name: string) =>
  screen.queryAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: "strong" }));
const row = (name: string): HTMLElement => {
  const li = maybeRow(name);
  if (!li) throw new Error(`no provider row named ${name}`);
  return li;
};
interface Req {
  method: string;
  path: string;
  body: Record<string, unknown>;
}
const last = (api: { requests: unknown[] }, method: string) =>
  [...(api.requests as Req[])].reverse().find((r) => r.method === method);
const lastBody = (api: { requests: unknown[] }, method: string) => (last(api, method)?.body ?? {}) as Record<string, unknown>;

describe("Settings", () => {
  it("lists providers with their model and whether a key is saved, never a key", async () => {
    await renderSettings();
    expect(within(row("OpenAI")).getByText(/gpt-x/)).toBeTruthy();
    expect(within(row("OpenAI")).getByText("Key saved")).toBeTruthy();
    expect(within(row("Local Ollama")).getByText("No key")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sk-/);
  });

  it("adds a provider through a password-type key field and shows it", async () => {
    const api = await renderSettings();
    const keyField = screen.getByLabelText("API key") as HTMLInputElement;
    expect(keyField.type).toBe("password");

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "OpenRouter" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "https://openrouter.ai/api/v1" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "anthropic/claude" } });
    fireEvent.change(keyField, { target: { value: "sk-or-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));

    await waitFor(() => row("OpenRouter"));
    expect(last(api, "POST")).toMatchObject({ body: { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "anthropic/claude", apiKey: "sk-or-1" } });
    expect(within(row("OpenRouter")).getByText("Key saved")).toBeTruthy();
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe(""); // form reset, key not retained
  });

  it("shows the server's message when adding fails", async () => {
    await renderSettings();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "openai" } });
    fireEvent.change(screen.getByLabelText("Base URL"), { target: { value: "http://x" } });
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "m" } });
    fireEvent.click(screen.getByRole("button", { name: "Add provider" }));
    expect((await screen.findByRole("alert")).textContent).toContain("already exists");
  });

  it("edits without changing the key: an empty key field is not sent", async () => {
    const api = await renderSettings();
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Edit" }));

    const key = screen.getByLabelText("API key") as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(key.value).toBe("");
    expect(key.placeholder).toMatch(/key saved/i);
    fireEvent.change(screen.getByLabelText("Model"), { target: { value: "gpt-y" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText(/gpt-y/);
    const patch = lastBody(api, "PATCH");
    expect(patch).toMatchObject({ model: "gpt-y" });
    expect("apiKey" in patch).toBe(false);
    expect(within(row("OpenAI")).getByText("Key saved")).toBeTruthy();
  });

  it("replaces the key when one is typed, and removes it on request", async () => {
    const api = await renderSettings();
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "sk-new" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(lastBody(api, "PATCH").apiKey).toBe("sk-new"));

    await screen.findByRole("button", { name: "Add provider" }); // form closed after saving
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByLabelText("Remove the saved key"));
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(lastBody(api, "PATCH").apiKey).toBeNull());
    await waitFor(() => expect(within(row("OpenAI")).getByText("No key")).toBeTruthy());
  });

  it("tests a connection and shows the result inline, success and failure", async () => {
    await renderSettings();
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Test connection" }));
    const ok = await within(row("OpenAI")).findByRole("status");
    expect(ok.textContent).toContain("Connected: the model answered in 42 ms.");
    expect(ok.textContent).toContain("42 ms");
    cleanup();

    await renderSettings({ testResult: { ok: false, latencyMs: 8, message: "Authentication failed (HTTP 401): check the API key." } });
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Test connection" }));
    const bad = await within(row("OpenAI")).findByRole("status");
    expect(bad.textContent).toContain("Authentication failed (HTTP 401): check the API key.");
    expect(bad.className).toContain("failed");
  });

  it("chooses the provider for each task, including none", async () => {
    const api = await renderSettings();
    const story = screen.getByLabelText("Story generation") as HTMLSelectElement;
    const grammar = screen.getByLabelText("Grammar content") as HTMLSelectElement;
    expect(story.value).toBe(A);
    expect(grammar.value).toBe("");

    fireEvent.change(grammar, { target: { value: B } });
    await waitFor(() => expect((screen.getByLabelText("Grammar content") as HTMLSelectElement).value).toBe(B));
    expect(last(api, "PUT")).toMatchObject({ path: "/ai-tasks/grammar_content", body: { providerId: B } });

    fireEvent.change(screen.getByLabelText("Story generation"), { target: { value: "" } });
    await waitFor(() => expect(api.tasks.story).toBeNull());
    expect(last(api, "DELETE")).toMatchObject({ path: "/ai-tasks/story" });
  });

  it("deletes a provider after confirmation, and explains why an assigned one cannot go", async () => {
    const api = await renderSettings();

    // Local Ollama is unassigned: delete needs a second click.
    fireEvent.click(within(row("Local Ollama")).getByRole("button", { name: "Delete" }));
    expect(api.requests.some((r) => r.method === "DELETE")).toBe(false);
    fireEvent.click(within(row("Local Ollama")).getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(maybeRow("Local Ollama")).toBeUndefined());

    // OpenAI is assigned to Story generation: the server refuses and the message is shown.
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Delete" }));
    fireEvent.click(within(row("OpenAI")).getByRole("button", { name: "Confirm delete" }));
    expect((await screen.findByRole("alert")).textContent).toContain("assigned to a task");
    expect(row("OpenAI")).toBeTruthy();
  });

  it("offers a retry when the server cannot be reached", async () => {
    const client = createApiClient({
      baseUrl: "http://api.test",
      fetch: async () => {
        throw new TypeError("network down");
      },
    });
    render(<Settings client={client} />);
    expect(await screen.findByText(/Cannot load settings/)).toBeTruthy();
    expect(await screen.findByText(/Cannot load MaruMori status/)).toBeTruthy();
    // Both sections offer a retry; the Learner is never logged out by a transport failure.
    expect(screen.getAllByRole("button", { name: "Retry" }).length).toBe(2);
  });
});

const connectedMaru: Partial<Maru> = {
  connected: true,
  connectedAt: "2026-01-05T09:00:00Z",
  lastSync: syncRun("55555555-5555-4555-8555-555555555555", "ok", { counts: syncCounts }),
  counts: { kanji: 120, vocabulary: 340, vocabularyLinkRate: 0.88, lastSyncAt: "2026-01-05T10:00:04Z" },
};

describe("Settings — MaruMori section", () => {
  it("asks for the API key in a password field when not connected", async () => {
    await renderSettings();
    const key = screen.getByLabelText("MaruMori API key") as HTMLInputElement;
    expect(key.type).toBe("password");
    expect(screen.queryByText("Connected to MaruMori")).toBeNull();
  });

  it("saves the key once and shows the connected status", async () => {
    const api = await renderSettings();
    fireEvent.change(screen.getByLabelText("MaruMori API key"), { target: { value: "mm-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByText("Connected to MaruMori")).toBeTruthy();
    expect(last(api, "PUT")).toMatchObject({ path: "/marumori/key", body: { apiKey: "mm-secret" } });
    expect((screen.getByLabelText("MaruMori API key") as HTMLInputElement).value).toBe("");
    expect(document.body.textContent).not.toContain("mm-secret");
  });

  it("shows the server's message when the key is rejected", async () => {
    await renderSettings({ rejectKey: true });
    fireEvent.change(screen.getByLabelText("MaruMori API key"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save key" }));
    expect((await screen.findByRole("alert")).textContent).toContain("API key was rejected");
  });

  it("shows known-item counts, link rate and the last Sync when connected", async () => {
    await renderSettings({ maruMori: connectedMaru });
    expect(await screen.findByText("Connected to MaruMori")).toBeTruthy();
    expect(screen.getByText(/Known kanji: 120/)).toBeTruthy();
    expect(screen.getByText(/Known vocabulary: 340/)).toBeTruthy();
    expect(screen.getByText(/Vocabulary linked: 88%/)).toBeTruthy();
    expect(screen.getByText(/Last Sync.*2026-01-05/)).toBeTruthy();
  });

  it("starts a Sync now and reports its outcome", async () => {
    const api = await renderSettings({ maruMori: connectedMaru });
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    const line = await screen.findByRole("status");
    expect(line.textContent).toContain("42 new");
    expect(line.className).toContain("ok");
    expect(api.requests.some((r) => r.method === "POST" && r.path === "/marumori/sync")).toBe(true);
  });

  it("shows a failed Sync's error message", async () => {
    await renderSettings({
      maruMori: connectedMaru,
      syncOutcome: syncRun("66666666-6666-4666-8666-666666666666", "failed", {
        error: "MaruMori request failed: the API key was rejected",
      }),
    });
    fireEvent.click(screen.getByRole("button", { name: "Sync now" }));
    const line = await screen.findByRole("status");
    expect(line.textContent).toContain("the API key was rejected");
    expect(line.className).toContain("failed");
  });

  it("removes the key after confirmation and returns to the form", async () => {
    const api = await renderSettings({ maruMori: connectedMaru });
    fireEvent.click(screen.getByRole("button", { name: "Remove key" }));
    expect(api.requests.some((r) => r.method === "DELETE" && r.path === "/marumori/key")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
    await waitFor(() => expect(api.maru.connected).toBe(false));
    expect(await screen.findByLabelText("MaruMori API key")).toBeTruthy();
  });

  it("lists recent Sync runs on request", async () => {
    const runs = [
      syncRun("77777777-7777-4777-8777-777777777777", "ok", { counts: syncCounts }),
      syncRun("88888888-8888-4888-8888-888888888888", "failed", { error: "MaruMori request failed: timeout" }),
    ];
    await renderSettings({ maruMori: { ...connectedMaru, runs } });
    fireEvent.click(screen.getByRole("button", { name: "Show recent Syncs" }));
    const heading = await screen.findByRole("heading", { name: "MaruMori" });
    const section = heading.closest("section");
    if (!section) throw new Error("MaruMori section not found");
    const items = within(section).getAllByRole("listitem");
    const text = items.map((li) => li.textContent).join("\n");
    expect(text).toContain("ok");
    expect(text).toContain("MaruMori request failed: timeout");
  });
});
