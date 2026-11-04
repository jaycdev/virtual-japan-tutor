// A stateful stand-in for the tutor API, shaped after the mobile suite's
// fakeApi: a mutable Story Library, a generation snapshot the test advances by
// hand, and a call log to assert against. Tests drive the real hooks and real
// fetch (through createApiClient); only the server is fake.
import {
  createApiClient,
  type ApiClient,
  type FocusSet,
  type MaruMoriStatus,
  type MaruMoriSyncRun,
  type Story,
  type StoryGenerationProgress,
  type StorySettings,
} from "@vjt/api-client";

export function makeStory(id: string, over: Partial<Story> = {}): Story {
  return {
    id,
    title: `ストーリー ${id}`,
    titleEn: `Story ${id}`,
    origin: "automatic",
    genre: "daily_life",
    text: "はじめました。",
    createdAt: "2026-10-01T08:00:00Z",
    sentences: [{ ja: "はじめました。", en: "I got started.", tokens: [], grammarSpans: [] }],
    questions: [],
    vocabItems: [],
    ...over,
  };
}

export interface Call {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

export interface FakeApiOptions {
  stories?: Story[];
  /** The /stories/today answer: a Story, null for 404 ("none yet"), "error" for a 500. */
  today?: Story | null | "error";
  settings?: Partial<StorySettings>;
  focus?: FocusSet;
  /** Vocabulary headwords for /dictionary/entries/{entSeq} and patterns for /grammar/points/{id}. */
  vocabulary?: Record<string, { headword: string; reading?: string }>;
  grammar?: Record<string, { pattern: string }>;
  marumori?: MaruMoriStatus;
  generation?: StoryGenerationProgress;
  suggestions?: { genres: string[]; themes: string[] };
  /** A lopsided page: return only this many items per page while total stays at stories.length. */
  pageSize?: number;
}

export interface FakeApi {
  client: ApiClient;
  /** The fake's raw fetch, to hand to the renderApp harness's fetchOverride. */
  fetch: (req: Request) => Promise<Response>;
  stories: Story[];
  calls: Call[];
  /** Flip to make DELETE /stories/{id} fail; tests use it to keep a delete honest. */
  rejectDeletes: boolean;
  setGeneration(p: StoryGenerationProgress): void;
  setMarumori(s: MaruMoriStatus): void;
  /** Push a freshly written Story into the Library (what a finished run leaves behind). */
  pushStory(story: Story): void;
}

export function fakeApi(options: FakeApiOptions = {}): FakeApi {
  const stories = options.stories ?? [];
  const calls: Call[] = [];
  let generation: StoryGenerationProgress = options.generation ?? { status: "idle", percent: 0 };
  let marumori: MaruMoriStatus = options.marumori ?? { connected: false };
  let syncRuns = 0;
  const today = options.today === undefined ? null : options.today;

  const settings: StorySettings = {
    furiganaThresholdSrsLevel: 3,
    timezone: "Asia/Tokyo",
    ...options.settings,
  };
  const focus: FocusSet = options.focus ?? { size: 15, items: [] };
  const suggestions = options.suggestions ?? { genres: ["travel", "mystery"], themes: ["food", "commute"] };

  const json = (value: unknown, status = 200) => Response.json(value, { status });
  const noContent = () => new Response(null, { status: 204 });
  const notFound = () => json({ message: "not found" }, 404);

  const api: FakeApi = {
    client: null as unknown as ApiClient,
    fetch: null as unknown as (req: Request) => Promise<Response>,
    stories,
    calls,
    rejectDeletes: false,
    setGeneration: (p) => {
      generation = p;
    },
    setMarumori: (s) => {
      marumori = s;
    },
    pushStory: (story) => {
      stories.unshift(story);
    },
  };

  const apiFetch: (req: Request) => Promise<Response> = async (req) => {
      const url = new URL(req.url);
      const path = url.pathname;
      const body = req.method === "GET" || req.method === "DELETE" ? undefined : await readBody(req);
      calls.push({ method: req.method, path, search: url.searchParams.toString(), body });

      if (req.method === "GET" && path === "/starting-level") {
        return json({ id: "11111111-1111-4111-8111-111111111111", username: "ada", configured: true });
      }

      if (req.method === "GET" && path === "/stories") {
        const limit = Number(url.searchParams.get("limit") ?? "20");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const slice = options.pageSize === undefined
          ? stories.slice(offset, offset + limit)
          : stories.slice(offset, offset + options.pageSize);
        return json({ items: slice, total: stories.length, limit, offset });
      }

      if (req.method === "GET" && path === "/stories/today") {
        if (today === "error") return json({ message: "storage read failed" }, 500);
        if (today === null) return notFound();
        return json(today);
      }

      if (req.method === "GET" && path === "/stories/suggestions") return json(suggestions);

      if (req.method === "GET" && path === "/stories/generation") return json(generation);

      if (req.method === "POST" && path === "/stories/generate") {
        generation = { status: "running", stage: "preparing", percent: 5, startedAt: new Date().toISOString() };
        return json(generation, 202);
      }

      const readMatch = /^\/stories\/([^/]+)\/read$/.exec(path);
      if (readMatch && (req.method === "PUT" || req.method === "DELETE")) {
        const story = stories.find((s) => s.id === readMatch[1]);
        if (!story) return notFound();
        if (req.method === "PUT") story.readAt = "2026-11-04T10:00:00Z";
        else delete story.readAt;
        return noContent();
      }

      const storyMatch = /^\/stories\/([^/]+)$/.exec(path);
      if (storyMatch && req.method === "DELETE") {
        if (api.rejectDeletes) return json({ message: "could not delete" }, 500);
        const index = stories.findIndex((s) => s.id === storyMatch[1]);
        if (index === -1) return notFound();
        stories.splice(index, 1);
        return noContent();
      }

      if (req.method === "GET" && path === "/story-settings") return json(settings);

      if (req.method === "GET" && path === "/focus-set") return json(focus);

      const entryMatch = entryGroup(/^\/dictionary\/entries\/([^/]+)$/, path);
      if (entryMatch && req.method === "GET") {
        const entry = options.vocabulary?.[entryMatch];
        if (!entry) return json({ found: false });
        return json({ found: true, entSeq: entryMatch, headword: entry.headword, reading: entry.reading });
      }

      const grammarMatch = entryGroup(/^\/grammar\/points\/([^/]+)$/, path);
      if (grammarMatch && req.method === "GET") {
        const point = options.grammar?.[grammarMatch];
        return point ? json({ id: grammarMatch, pattern: point.pattern }) : notFound();
      }

      if (req.method === "GET" && path === "/marumori") return json(marumori);

      if (req.method === "POST" && path === "/marumori/sync") {
        syncRuns += 1;
        const run: MaruMoriSyncRun = {
          id: `sync-${syncRuns}`,
          status: "ok",
          startedAt: "2026-11-04T09:59:00Z",
          finishedAt: "2026-11-04T10:00:00Z",
          counts: {
            kanji: 40,
            vocabulary: 120,
            grammarReviews: 0,
            grammarLessons: 0,
            linked: 2,
            unlinked: 0,
            ambiguous: 0,
            new: 3,
            levelChanges: 1,
            disappeared: 0,
            skippedLevelZero: 0,
          },
        };
        marumori = { ...marumori, connected: true, lastSync: run, lastFailure: null };
        return json(run);
      }

    return notFound();
  };

  api.client = createApiClient({ baseUrl: "http://api.test", fetch: apiFetch });
  api.fetch = apiFetch;

  return api;
}

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  return text === "" ? undefined : JSON.parse(text);
}

/** The first capture group of a path pattern, or null when the path misses. */
function entryGroup(pattern: RegExp, path: string): string | null {
  const match = pattern.exec(path);
  return match?.[1] ?? null;
}
