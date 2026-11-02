import type {
  ApiClient,
  GenerateStoryRequest,
  StoryGenerationProgress,
  StorySuggestions,
} from "@vjt/api-client";
import { useCallback, useEffect, useState } from "react";
import type { ActionResult } from "./useAiSettings.ts";

/**
 * State behind the On-demand Generate button and its progress bar (issue #33).
 * The run lives on the server, not in this component: the hook reads the
 * server's snapshot once on mount and keeps polling only while a run is live,
 * so a reload mid-run finds the same picture and navigating away never
 * cancels anything. There is no streaming — each poll is one snapshot, and
 * the percent is the server's, not ours.
 *
 * The terminal ready/failed snapshot stays until the next start, which is
 * what keeps "Couldn't write a Story that fits your vocabulary. Try again?"
 * on screen across a reload. A ready Story is never opened from here; the
 * caller offers "Ready, read now".
 */

/** What the Learner sees: the last snapshot's status, plus its progress. */
export type StoryGenerationState =
  | { status: "idle" }
  | { status: "running"; progress: StoryGenerationProgress }
  | { status: "ready"; progress: StoryGenerationProgress }
  | { status: "failed"; progress: StoryGenerationProgress };

export interface StoryGeneration {
  /** The run's state, from the server's snapshots. */
  generation: StoryGenerationState;
  /** Start a run. Only one per Learner: a second start is refused while one runs. */
  startGeneration(req: GenerateStoryRequest): Promise<ActionResult>;
  /** The last refusal (e.g. "A Story is already being written for you."). */
  error: string | null;
  /** Autocomplete options for the genre and theme boxes. */
  suggestions: StorySuggestions;
}

export function useStoryGeneration(client: ApiClient, pollMs = 1500): StoryGeneration {
  const [generation, setGeneration] = useState<StoryGenerationState>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<StorySuggestions>({ genres: [], themes: [] });
  // Bumped to (re)start the poll loop: once on mount, and again whenever a
  // start lands or a refusal suggests another run is already live.
  const [watch, setWatch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    client
      .GET("/stories/suggestions")
      .then((res) => {
        if (!cancelled && res.data) setSuggestions(res.data);
      })
      .catch(() => {
        // Autocomplete is a convenience; an empty list still leaves free text.
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function read(liveBefore: boolean) {
      let live = liveBefore;
      try {
        const res = await client.GET("/stories/generation");
        if (cancelled) return;
        if (!res.error) {
          const next = view(res.data);
          live = next.status === "running";
          setGeneration(next);
        }
      } catch {
        // Network blip: keep the last snapshot; retried below only if a run
        // was live, so an idle hook with an unreachable server stays quiet.
      }
      if (live) timer = setTimeout(() => void read(true), pollMs);
    }
    void read(false);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [client, pollMs, watch]);

  const startGeneration = useCallback(
    async (req: GenerateStoryRequest): Promise<ActionResult> => {
      try {
        const res = await client.POST("/stories/generate", { body: req });
        if (res.error) {
          const message =
            ("message" in res.error && res.error.message) || "Couldn't start writing a Story.";
          setError(message);
          // The refusal came from a run already going (Automatic or another
          // tap): re-read the server so that run shows in the bar.
          if ("code" in res.error && res.error.code === "generation_running") setWatch((w) => w + 1);
          return { ok: false, message };
        }
        setError(null);
        // 202 carries the first snapshot; the loop keeps it moving.
        setGeneration(view(res.data));
        setWatch((w) => w + 1);
        return { ok: true };
      } catch {
        const message = "Couldn't start writing a Story.";
        setError(message);
        return { ok: false, message };
      }
    },
    [client],
  );

  return { generation, startGeneration, error, suggestions };
}

function view(p: StoryGenerationProgress): StoryGenerationState {
  switch (p.status) {
    case "running":
      return { status: "running", progress: p };
    case "ready":
      return { status: "ready", progress: p };
    case "failed":
      return { status: "failed", progress: p };
    default:
      return { status: "idle" };
  }
}
