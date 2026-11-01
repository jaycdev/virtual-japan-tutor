import type {
  ApiClient,
  Story,
  StoryAnswerResult,
  StoryPage,
  StoryRating,
  StorySettings,
} from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";

/**
 * State and actions behind the Story screens (issue #10), shared by web and
 * mobile. Generation is never triggered from here: the background generator
 * keeps one ready Story per Learner, and `openReady` fetches it from storage —
 * the request never waits on an AI provider, so opening a Story is instant.
 * Opening clears the ready marker; the next background pass writes a new one.
 *
 * Like the other hooks this never rejects: failures land in `error`. Answer
 * verdicts are kept per question position for the open Story (the server
 * never sends the right answer up front, and each question answers at most
 * once — the first answer also wrote Practice Records for the Story's Focus
 * Set items, which `practiceRecorded` reports). Ratings are held on both the
 * library page and the open Story so the thumbs show immediately.
 */

export const NO_READY_STORY =
  "No story is ready yet. The tutor writes them for you regularly — check back soon.";

export type StoryLibraryState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: StoryPage };

/** The Learner's Story settings: furigana threshold and preferred genre/theme. */
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
  /** The Story Library, one page at a time, newest first. */
  library: StoryLibraryState;
  /** The open Story, when one is open (ready or from the library). */
  story: Story | null;
  /** True while `story` is a just-opened ready Story (shows a practice note once answered). */
  open: boolean;
  /** True while an open/answer/rate request is in flight. */
  pending: boolean;
  error: string | null;
  /** The library page's questions are not loaded here; only the open Story has them. */
  questions: StoryQuestionView[];
  /** Story settings: furigana threshold, and the genre/theme future stories aim for. */
  settings: StorySettingsState;
  /** Save the settings; the server's answer becomes the new state. Empty genre/theme means "surprise me". */
  saveSettings(next: StorySettings): Promise<ActionResult>;
  /** Re-fetch the settings after an error. */
  reloadSettings(): void;
  loadPage(offset: number): Promise<void>;
  reload(): void;
  /** Fetch the ready Story and open it. `no_ready_story` shows NO_READY_STORY, not an error. */
  openReady(): Promise<void>;
  /** Open one Story from the library by id. */
  openStory(id: string): Promise<void>;
  close(): void;
  /** Thumbs up/down on any of the Learner's stories; replaceable. */
  rate(storyId: string, rating: StoryRating): Promise<void>;
  /** Answer question `position` once; later calls for the same question are ignored. */
  answer(position: number, optionIndex: number): Promise<void>;
}

const UNREACHABLE = "Cannot reach the server";
const FAILED = "Request failed";
const DEFAULT_LIMIT = 10;

function message(error: { message?: string } | undefined, status: number): string {
  return error?.message ?? `${FAILED} (${status})`;
}

export function useStory(client: ApiClient, limit = DEFAULT_LIMIT): StoryView {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [library, setLibrary] = useState<StoryLibraryState>({ status: "loading" });
  const [story, setStory] = useState<Story | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Map<number, StoryAnswerResult>>(() => new Map());
  const [settings, setSettings] = useState<StorySettingsState>({ status: "loading" });
  const [settingsAttempt, setSettingsAttempt] = useState(0);

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

  const loadPage = useCallback(async (next: number) => {
    setOffset(Math.max(0, next));
  }, []);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  // Story settings ride along with the library screen: the Furigana
  // Threshold and the preferred genre/theme (empty = "surprise me").
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

  const refreshList = useCallback(async () => {
    const next = await fetchPage();
    if (next.status === "ready") setLibrary(next);
  }, [fetchPage]);

  const showStory = useCallback((s: Story) => {
    setStory(s);
    setOpen(true);
    setAnswers(new Map());
    setError(null);
  }, []);

  const openReady = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const { data, error: err, response } = await client.GET("/stories/ready");
      if (data) {
        showStory(data);
        void refreshList();
      } else if (response.status === 404) {
        setError(NO_READY_STORY);
      } else {
        setError(message(err, response.status));
      }
    } catch {
      setError(UNREACHABLE);
    } finally {
      setPending(false);
    }
  }, [client, showStory, refreshList]);

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
    setStory(null);
    setOpen(false);
    setAnswers(new Map());
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
        // Reflect the new rating on the open Story and on the library page.
        setStory((prev) => (prev && prev.id === storyId ? { ...prev, rating } : prev));
        setLibrary((prev) =>
          prev.status === "ready"
            ? {
                status: "ready",
                page: {
                  ...prev.page,
                  items: prev.page.items.map((s) => (s.id === storyId ? { ...s, rating } : s)),
                },
              }
            : prev,
        );
      } catch {
        setError(UNREACHABLE);
      } finally {
        setPending(false);
      }
    },
    [client],
  );

  const answer = useCallback(
    async (position: number, optionIndex: number) => {
      if (!story || pending || answers.has(position)) return;
      setPending(true);
      setError(null);
      try {
        const { data, error: err, response } = await client.POST("/stories/{storyId}/answers", {
          params: { path: { storyId: story.id } },
          body: { questionIndex: position, answerIndex: optionIndex },
        });
        if (!data) setError(message(err, response.status));
        else setAnswers((prev) => new Map(prev).set(position, data));
      } catch {
        setError(UNREACHABLE);
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
    library,
    story,
    open,
    pending,
    error,
    questions,
    settings,
    saveSettings,
    reloadSettings,
    loadPage,
    reload,
    openReady,
    openStory,
    close,
    rate,
    answer,
  };
}
