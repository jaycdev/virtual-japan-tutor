import type {
  ApiClient,
  Story,
  StoryAnswerResult,
  StoryPage,
  StoryRating,
  StorySettings,
} from "@vjt/api-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";
import { FAILED, UNREACHABLE } from "./errors.ts";

/**
 * State and actions behind the Story screens (issues #10, #31, #32), shared by
 * web and mobile. Generation is never triggered from here: the background
 * generator writes one Automatic Story per day in the Learner's Timezone, and
 * `today` fetches Today's Story — the newest of them — from storage. The
 * request never waits on an AI provider, so opening a Story is instant.
 *
 * Like the other hooks this never rejects: failures land in `error`. Answer
 * verdicts are kept per question position for the open Story (the server
 * never sends the right answer up front, and each question answers at most
 * once — the first answer also wrote Practice Records for the Story's Focus
 * Set items, which `practiceRecorded` reports). Ratings are held on both the
 * library page and the open Story so the thumbs show immediately.
 */

/**
 * Today's Story (GLOSSARY.md): the newest Automatic Story, or `none` while
 * the Learner has no Automatic Story yet — the generator writes one per
 * local day, so "none" is the "a story is on its way" state, not an error.
 * A read one carries its readAt; the view words it as "still unread from
 * <day>".
 */
export type TodaysStoryState =
  | { status: "loading" }
  | { status: "story"; story: Story }
  | { status: "none" }
  | { status: "error"; message: string };

export type StoryLibraryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: StoryPage };

/** The Learner's Story settings: furigana threshold, preferred genre/theme and timezone. */
export type StorySettingsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; settings: StorySettings };

/** One comprehension question of the open Story, with the Learner's verdict. */
export interface StoryQuestionView {
  position: number;
  promptJa: string;
  optionsJa: string[];
  result: StoryAnswerResult | null;
}

export interface StoryView {
  /** Today's Story: the newest Automatic Story, or `none` until the generator writes one. */
  today: TodaysStoryState;
  /** Re-fetch Today's Story (the empty state invites it once a story lands). */
  reloadToday(): void;
  /** The Story Library, one page at a time, newest first. */
  library: StoryLibraryState;
  /** The open Story, when one is open (Today's Story or from the library). */
  story: Story | null;
  /** True while `story` is a just-opened Story (shows a practice note once answered). */
  open: boolean;
  /** True while an open/answer/rate request is in flight. */
  pending: boolean;
  error: string | null;
  /** The library page's questions are not loaded here; only the open Story has them. */
  questions: StoryQuestionView[];
  /** Story settings: furigana threshold, the genre/theme future stories aim for, and the Learner's Timezone. */
  settings: StorySettingsState;
  /** Save the settings; the server's answer becomes the new state. Empty genre/theme means "surprise me". */
  saveSettings(next: StorySettings): Promise<ActionResult>;
  /** Re-fetch the settings after an error. */
  reloadSettings(): void;
  loadPage(offset: number): Promise<void>;
  reload(): void;
  /** Open one Story from the library by id. */
  openStory(id: string): Promise<void>;
  close(): void;
  /** Thumbs up/down on any of the Learner's stories; replaceable. */
  rate(storyId: string, rating: StoryRating): Promise<void>;
  /** Mark a Library story Read by hand; not practice, and reversible. */
  setRead(storyId: string): Promise<void>;
  /** Unmark a Library story so it reads as unread again. */
  clearRead(storyId: string): Promise<void>;
  /** Delete a story from the Library; its rating goes, its Practice Records stay. */
  removeStory(storyId: string): Promise<void>;
  /** Answer question `position` once; later calls for the same question are ignored. */
  answer(position: number, optionIndex: number): Promise<void>;
}

const DEFAULT_LIMIT = 20;

function message(error: { message?: string } | undefined, status: number): string {
  return error?.message ?? `${FAILED} (${status})`;
}

export interface StorySettingsView {
  /** Story settings: furigana threshold, the genre/theme future stories aim for, and the Learner's Timezone. */
  settings: StorySettingsState;
  /** Save the settings; the server's answer becomes the new state. Empty genre/theme means "surprise me". */
  saveSettings(next: StorySettings): Promise<ActionResult>;
  /** Re-fetch the settings after an error. */
  reloadSettings(): void;
}

/**
 * The Learner's Story settings on their own, without the library list: the
 * mobile Settings screen edits the Furigana Threshold without paying for a
 * `/stories` fetch. `useStory` composes it in so the web Story screens keep
 * the settings riding along with the library.
 */
export function useStorySettings(client: ApiClient): StorySettingsView {
  const [settings, setSettings] = useState<StorySettingsState>({ status: "loading" });
  const [settingsAttempt, setSettingsAttempt] = useState(0);

  // Story settings: the Furigana Threshold and the preferred genre/theme
  // (empty = "surprise me").
  const fetchSettings = useCallback(async (): Promise<StorySettingsState> => {
    try {
      const { data, error: err, response } = await client.GET("/story-settings");
      if (data) return { status: "ready", settings: data };
      return { status: "error", message: message(err, response.status) };
    } catch {
      return { status: "error", message: UNREACHABLE };
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void fetchSettings().then((next) => {
      if (!cancelled) setSettings(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSettings, settingsAttempt]);

  const reloadSettings = useCallback(() => setSettingsAttempt((n) => n + 1), []);

  const saveSettings = useCallback(
    async (next: StorySettings): Promise<ActionResult> => {
      try {
        const { data, error: err, response } = await client.PUT("/story-settings", { body: next });
        if (data) {
          setSettings({ status: "ready", settings: data });
          return { ok: true };
        }
        return { ok: false, message: message(err, response.status) };
      } catch {
        return { ok: false, message: UNREACHABLE };
      }
    },
    [client],
  );

  return { settings, saveSettings, reloadSettings };
}

/**
 * Today's Story on its own (issue #47): the Today screen's card needs the
 * newest Automatic Story without the library page `useStory` also loads. Same
 * read, same rules — a 404 means the generator has not written one (yet), not
 * that something failed.
 */
export async function fetchTodaysStory(client: ApiClient): Promise<TodaysStoryState> {
  try {
    const { data, error: err, response } = await client.GET("/stories/today");
    if (data) return { status: "story", story: data };
    if (response.status === 404) return { status: "none" };
    return { status: "error", message: message(err, response.status) };
  } catch {
    return { status: "error", message: UNREACHABLE };
  }
}

export interface TodaysStoryView {
  today: TodaysStoryState;
  /** Re-read: the empty state invites it, and a finished run ends on it. */
  reloadToday(): void;
}

export function useTodaysStory(client: ApiClient): TodaysStoryView {
  const [today, setToday] = useState<TodaysStoryState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchTodaysStory(client).then((next) => {
      if (!cancelled) setToday(next);
    });
    return () => {
      cancelled = true;
    };
  }, [client, attempt]);

  const reloadToday = useCallback(() => {
    // A manual reload flips the card to its loading state in place of the
    // stale error, so pressing Retry visibly does something (issue #47
    // review N7). The initial state is already loading, so the flip lives
    // in this callback rather than in the effect.
    setToday({ status: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  return { today, reloadToday };
}

export function useStory(client: ApiClient, limit = DEFAULT_LIMIT): StoryView {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [library, setLibrary] = useState<StoryLibraryState>({ status: "loading" });
  const [today, setToday] = useState<TodaysStoryState>({ status: "loading" });
  const [todayAttempt, setTodayAttempt] = useState(0);
  const [story, setStory] = useState<Story | null>(null);
  // Which Story is open right now, readable from async callbacks without
  // re-creating them: an answer's response is only painted while the Story
  // it was asked about is still the open one.
  const openIdRef = useRef<string | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Map<number, StoryAnswerResult>>(() => new Map());

  const fetchPage = useCallback(async (): Promise<StoryLibraryState> => {
    try {
      const { data, error: err, response } = await client.GET("/stories", {
        params: { query: { limit, offset } },
      });
      if (data) return { status: "ready", page: data };
      return { status: "error", message: message(err, response.status) };
    } catch {
      return { status: "error", message: UNREACHABLE };
    }
  }, [client, limit, offset]);

  useEffect(() => {
    let cancelled = false;
    void fetchPage().then((next) => {
      if (!cancelled) setLibrary(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchPage, attempt]);

  // Today's Story comes from storage, exactly like opening it: a 404 is the
  // "the generator has not written one (yet)" state, not a failure; anything
  // else is a real error the view can retry.
  const fetchToday = useCallback(async (): Promise<TodaysStoryState> => fetchTodaysStory(client), [client]);

  useEffect(() => {
    let cancelled = false;
    void fetchToday().then((next) => {
      if (!cancelled) setToday(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchToday, todayAttempt]);

  // Registered after the library effect so the settings fetch follows the
  // library fetch on mount, matching the web screen's request order.
  const storySettings = useStorySettings(client);

  const loadPage = useCallback(async (next: number) => {
    setOffset(Math.max(0, next));
  }, []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const reloadToday = useCallback(() => setTodayAttempt((n) => n + 1), []);

  const refreshToday = useCallback(async () => {
    setToday(await fetchToday());
  }, [fetchToday]);

  const showStory = useCallback((s: Story) => {
    openIdRef.current = s.id;
    setStory(s);
    setOpen(true);
    setAnswers(new Map());
    setError(null);
  }, []);

  const openStory = useCallback(
    async (id: string) => {
      setPending(true);
      setError(null);
      try {
        const { data, error: err, response } = await client.GET("/stories/{storyId}", {
          params: { path: { storyId: id } },
        });
        if (data) showStory(data);
        else setError(message(err, response.status));
      } catch {
        setError(UNREACHABLE);
      } finally {
        setPending(false);
      }
    },
    [client, showStory],
  );

  const close = useCallback(() => {
    openIdRef.current = null;
    setStory(null);
    setOpen(false);
    setAnswers(new Map());
  }, []);

  // Paint one library item in place, leaving the page and its total alone.
  // The Read mark only needs a truthy readAt locally; the next fetch carries
  // the server's exact stamp. Today's Story, when it is the same Story, is
  // painted too so its read mark and thumbs stay truthful on screen.
  const patchItem = useCallback((storyId: string, patch: Partial<Story>) => {
    setLibrary((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            page: {
              ...prev.page,
              items: prev.page.items.map((s) => (s.id === storyId ? { ...s, ...patch } : s)),
            },
          }
        : prev,
    );
    setStory((prev) => (prev && prev.id === storyId ? { ...prev, ...patch } : prev));
    setToday((prev) => (prev.status === "story" && prev.story.id === storyId ? { status: "story", story: { ...prev.story, ...patch } } : prev));
  }, []);

  const rate = useCallback(
    async (storyId: string, rating: StoryRating) => {
      setPending(true);
      setError(null);
      try {
        const { error: err, response } = await client.POST("/stories/{storyId}/rate", {
          params: { path: { storyId } },
          body: rating,
        });
        if (response.status !== 204) {
          setError(message(err, response.status));
          return;
        }
        // Reflect the new rating on the open Story, the library page and
        // Today's Story.
        patchItem(storyId, { rating });
      } catch {
        setError(UNREACHABLE);
      } finally {
        setPending(false);
      }
    },
    [client, patchItem],
  );

  const setRead = useCallback(
    async (storyId: string) => {
      setPending(true);
      setError(null);
      try {
        const { error: err, response } = await client.PUT("/stories/{storyId}/read", {
          params: { path: { storyId } },
        });
        if (response.status !== 204) {
          setError(message(err, response.status));
          return;
        }
        patchItem(storyId, { readAt: new Date().toISOString() });
      } catch {
        setError(UNREACHABLE);
      } finally {
        setPending(false);
      }
    },
    [client, patchItem],
  );

  const clearRead = useCallback(
    async (storyId: string) => {
      setPending(true);
      setError(null);
      try {
        const { error: err, response } = await client.DELETE("/stories/{storyId}/read", {
          params: { path: { storyId } },
        });
        if (response.status !== 204) {
          setError(message(err, response.status));
          return;
        }
        // The Go server omits a null readAt rather than sending null, so
        // clearing locally means dropping the key too.
        patchItem(storyId, { readAt: undefined });
      } catch {
        setError(UNREACHABLE);
      } finally {
        setPending(false);
      }
    },
    [client, patchItem],
  );

  // Deleting drops the row from the page right away; the reader closes too
  // if that story happens to be open. Practice Records are not touched.
  const removeStory = useCallback(
    async (storyId: string) => {
      setPending(true);
      setError(null);
      try {
        const { error: err, response } = await client.DELETE("/stories/{storyId}", {
          params: { path: { storyId } },
        });
        if (response.status !== 204) {
          setError(message(err, response.status));
          return;
        }
        setLibrary((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                page: {
                  ...prev.page,
                  items: prev.page.items.filter((s) => s.id !== storyId),
                  total: Math.max(0, prev.page.total - 1),
                },
              }
            : prev,
        );
        if (openIdRef.current === storyId) close();
        // Deleting Today's Story hands the day to the older Automatic Story
        // underneath it (or to the empty state if that was the last one).
        if (today.status === "story" && today.story.id === storyId) void refreshToday();
      } catch {
        setError(UNREACHABLE);
      } finally {
        setPending(false);
      }
    },
    [client, close, today, refreshToday],
  );

  const answer = useCallback(
    async (position: number, optionIndex: number) => {
      if (!story || pending || answers.has(position)) return;
      const storyId = story.id;
      setPending(true);
      setError(null);
      try {
        const { data, error: err, response } = await client.POST("/stories/{storyId}/answers", {
          params: { path: { storyId } },
          body: { questionIndex: position, answerIndex: optionIndex },
        });
        // The Learner may have closed or switched the Story while this was
        // in flight; its verdict and its error belong to that Story, so a
        // late reply must not paint the now-open one.
        if (openIdRef.current !== storyId) return;
        if (!data) setError(message(err, response.status));
        else setAnswers((prev) => new Map(prev).set(position, data));
      } catch {
        if (openIdRef.current === storyId) setError(UNREACHABLE);
      } finally {
        setPending(false);
      }
    },
    [client, story, pending, answers],
  );

  const questions: StoryQuestionView[] = (story?.questions ?? []).map((q) => ({
    position: q.position,
    promptJa: q.promptJa,
    optionsJa: q.optionsJa,
    result: answers.get(q.position) ?? null,
  }));

  return {
    today,
    reloadToday,
    library,
    story,
    open,
    pending,
    error,
    questions,
    ...storySettings,
    loadPage,
    reload,
    openStory,
    close,
    rate,
    setRead,
    clearRead,
    removeStory,
    answer,
  };
}
