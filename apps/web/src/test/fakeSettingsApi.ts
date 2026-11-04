// A small stateful stand-in for the endpoints the Settings sections and the setup
// wizard call. Tests seed it, drive the real UI through renderAppAt, and then read
// `writes` to check what was sent (keys included, so a test can prove a key was
// never put into a field or a body it should not be in).

export interface FakeList {
  id: string;
  name: string;
  boosting: boolean;
  isDefault: boolean;
  itemCount: number;
}

export interface FakeMember {
  itemKind: "kanji" | "vocabulary" | "grammar";
  itemRef: string;
  surface: string;
  gloss: string | null;
}

export interface FakeProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FakeWrite {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeState {
  reading: { blurTranslation: boolean; lookupHoldMs: number };
  story: { furiganaThresholdSrsLevel: number; preferredGenre: string; preferredTheme: string; timezone: string };
  level: { configured: boolean; level: string };
  lists: FakeList[];
  defaultListId: string;
  members: Record<string, FakeMember[]>;
  marumori: { connected: boolean; counts?: { kanji: number; vocabulary: number; vocabularyLinkRate: number; lastSyncAt: string } };
  providers: FakeProvider[];
  tasks: { task: "story" | "grammar_content"; providerId: string | null }[];
  health: { status: "ok" | "degraded"; database: "ok" | "unreachable" };
  /** A write to this "METHOD path" answers 422 with the message, once. */
  failNext: Record<string, string>;
  writes: FakeWrite[];
}

export function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    reading: { blurTranslation: true, lookupHoldMs: 800 },
    story: { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "", timezone: "" },
    level: { configured: true, level: "N4" },
    lists: [
      { id: "saved", name: "Saved", boosting: false, isDefault: true, itemCount: 1 },
      { id: "food", name: "Food", boosting: true, isDefault: false, itemCount: 0 },
    ],
    defaultListId: "saved",
    members: { saved: [{ itemKind: "vocabulary", itemRef: "1358280", surface: "食べる", gloss: "to eat" }], food: [] },
    marumori: { connected: false },
    providers: [],
    tasks: [
      { task: "story", providerId: null },
      { task: "grammar_content", providerId: null },
    ],
    health: { status: "ok", database: "ok" },
    failNext: {},
    writes: [],
    ...overrides,
  };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const noContent = () => new Response(null, { status: 204 });

/**
 * The handler to pass as renderAppAt's `api` option. Returns undefined for paths
 * it does not know, so the harness falls through to its own defaults.
 */
export function fakeSettingsApi(state: FakeState) {
  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const path = url.pathname;
    const body: unknown = method === "GET" || method === "DELETE" ? undefined : await request.clone().json().catch(() => undefined);
    if (method !== "GET") state.writes.push({ method, path: `${path}${url.search}`, body });

    const failure = state.failNext[`${method} ${path}`];
    if (failure !== undefined && method !== "GET") {
      delete state.failNext[`${method} ${path}`];
      return json({ message: failure }, 422);
    }

    // Reading and Stories
    if (path === "/reading-settings") {
      if (method === "PUT") state.reading = body as FakeState["reading"];
      return json(state.reading);
    }
    if (path === "/story-settings") {
      if (method === "PUT") state.story = body as FakeState["story"];
      return json(state.story);
    }

    // Starting Level and grammar review
    if (path === "/starting-level") {
      if (method === "PUT") {
        const next = body as { level: string };
        state.level = { configured: true, level: next.level };
        return json({ configured: true, level: next.level, added: 4, removed: 1 });
      }
      return json({ configured: state.level.configured, level: state.level.level });
    }
    if (path === "/grammar/review") return json([]);

    // MaruMori
    if (path === "/marumori" && method === "GET") {
      return json({ connected: state.marumori.connected, ...(state.marumori.counts ? { counts: state.marumori.counts } : {}) });
    }
    if (path === "/marumori/key") {
      state.marumori.connected = method === "PUT";
      return noContent();
    }
    if (path === "/marumori/sync" && method === "POST") {
      return json({
        id: "run-1",
        startedAt: "2026-11-04T10:00:00Z",
        status: "ok",
        counts: { kanji: 12, vocabulary: 300, new: 3, levelChanges: 1, disappeared: 0 },
      });
    }
    if (path === "/marumori/syncs") return json([]);

    // Item Lists
    if (path === "/item-lists" && method === "GET") return json({ items: state.lists, defaultListId: state.defaultListId });
    if (path === "/item-lists" && method === "POST") {
      const input = body as { name: string; boosting: boolean };
      const created: FakeList = {
        id: `list-${state.lists.length + 1}`,
        name: input.name,
        boosting: input.boosting,
        isDefault: false,
        itemCount: 0,
      };
      state.lists = [...state.lists, created];
      state.members[created.id] = [];
      return json(created, 201);
    }
    if (path === "/item-lists/default" && method === "PUT") {
      state.defaultListId = (body as { listId: string }).listId;
      state.lists = state.lists.map((l) => ({ ...l, isDefault: l.id === state.defaultListId }));
      return noContent();
    }
    const listMatch = path.match(/^\/item-lists\/([^/]+)$/);
    if (listMatch) {
      const id = listMatch[1];
      if (method === "PUT") {
        const patch = body as { name?: string; boosting?: boolean };
        state.lists = state.lists.map((l) => (l.id === id ? { ...l, ...patch } : l));
        return json({});
      }
      if (method === "DELETE") {
        state.lists = state.lists.filter((l) => l.id !== id);
        return noContent();
      }
    }
    const itemsMatch = path.match(/^\/item-lists\/([^/]+)\/items$/);
    if (itemsMatch?.[1]) {
      const id = itemsMatch[1];
      if (method === "GET") return json({ items: state.members[id] ?? [] });
      if (method === "POST") {
        const input = body as { itemKind: FakeMember["itemKind"]; itemRef: string };
        state.members[id] = [...(state.members[id] ?? []), { ...input, surface: input.itemRef, gloss: null }];
        state.lists = state.lists.map((l) => (l.id === id ? { ...l, itemCount: l.itemCount + 1 } : l));
        return noContent();
      }
      if (method === "DELETE") {
        const ref = url.searchParams.get("itemRef");
        state.members[id] = (state.members[id] ?? []).filter((m) => m.itemRef !== ref);
        state.lists = state.lists.map((l) => (l.id === id ? { ...l, itemCount: Math.max(0, l.itemCount - 1) } : l));
        return noContent();
      }
    }

    // AI providers and task assignments
    if (path === "/ai-providers" && method === "GET") return json(state.providers);
    if (path === "/ai-providers" && method === "POST") {
      const input = body as { name: string; baseUrl: string; model: string; apiKey?: string };
      const created: FakeProvider = {
        id: `p-${state.providers.length + 1}`,
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.model,
        hasApiKey: "apiKey" in (input as object),
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-01T00:00:00Z",
      };
      state.providers = [...state.providers, created];
      return json(created, 201);
    }
    const providerMatch = path.match(/^\/ai-providers\/([^/]+)$/);
    if (providerMatch) {
      const id = providerMatch[1];
      if (method === "PATCH") {
        const patch = body as { name?: string; baseUrl?: string; model?: string; apiKey?: string | null };
        state.providers = state.providers.map((p) =>
          p.id === id
            ? {
                ...p,
                name: patch.name ?? p.name,
                baseUrl: patch.baseUrl ?? p.baseUrl,
                model: patch.model ?? p.model,
                hasApiKey: patch.apiKey === null ? false : patch.apiKey ? true : p.hasApiKey,
              }
            : p,
        );
        return json(state.providers.find((p) => p.id === id));
      }
      if (method === "DELETE") {
        if (state.tasks.some((t) => t.providerId === id)) {
          return json({ message: "That provider is used for a task. Choose another provider first." }, 409);
        }
        state.providers = state.providers.filter((p) => p.id !== id);
        return noContent();
      }
    }
    if (/^\/ai-providers\/[^/]+\/test$/.test(path) && method === "POST") {
      return json({ ok: true, latencyMs: 120, message: "Connected" });
    }
    const taskMatch = path.match(/^\/ai-tasks\/(story|grammar_content)$/);
    if (taskMatch) {
      const task = taskMatch[1] as FakeState["tasks"][number]["task"];
      if (method === "PUT") {
        const providerId = (body as { providerId: string }).providerId;
        state.tasks = state.tasks.map((t) => (t.task === task ? { ...t, providerId } : t));
      }
      if (method === "DELETE") state.tasks = state.tasks.map((t) => (t.task === task ? { ...t, providerId: null } : t));
      return noContent();
    }
    if (path === "/ai-tasks" && method === "GET") return json(state.tasks);

    // Health
    if (path === "/health") {
      return json(state.health, state.health.status === "ok" ? 200 : 503);
    }

    return undefined;
  };
}
