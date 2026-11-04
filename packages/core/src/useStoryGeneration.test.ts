// useStoryGeneration (issue #33): the On-demand Generate button's state and
// the server-tracked progress bar. The run lives on the server, not in this
// request — the hook polls, so a reload mid-run finds the same picture and
// navigating away never cancels anything.

import type { StoryGenerationProgress, StorySuggestions } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStoryGeneration } from "./useStoryGeneration.ts";

/** Fast polling for tests; production keeps the 1.5s default. */
const POLL = 20;

type Stage = NonNullable<StoryGenerationProgress["stage"]>;

function running(stage: Stage, attempt: number, percent: number): StoryGenerationProgress {
  return { status: "running", stage, attempt, maxAttempts: 3, percent, startedAt: "2026-11-02T09:00:00Z" };
}

interface Routes {
  // Queued answers for GET /stories/generation; the last one repeats.
  generation?: StoryGenerationProgress[];
  // The first POST /stories/generate answer.
  generate?: { status: number; body: unknown };
  suggestions?: StorySuggestions;
}

function harness(routes: Routes = {}) {
  const fetchImpl = vi.fn();
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  const queue = [...(routes.generation ?? [{ status: "idle", percent: 0 } as StoryGenerationProgress])];
  const posts: { body: unknown }[] = [];
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  fetchImpl.mockImplementation(async (req: Request) => {
    const url = new URL(req.url);
    if (req.method === "POST" && url.pathname === "/stories/generate") {
      posts.push({ body: JSON.parse(await req.text()) });
      const answer = routes.generate ?? { status: 202, body: running("preparing", 1, 5) };
      return json(answer.status, answer.body);
    }
    if (url.pathname === "/stories/generation") {
      return json(200, queue.length > 1 ? queue.shift() : queue[0]);
    }
    if (url.pathname === "/stories/suggestions") {
      return json(200, routes.suggestions ?? { genres: [], themes: [] });
    }
    return json(404, { code: "not_found", message: "unexpected path" });
  });
  const generationCalls = () =>
    fetchImpl.mock.calls.filter(([req]) => (req as Request).url.includes("/stories/generation"));
  // Replaces the queue, so the snapshot served from now on is this one.
  const finish = (progress: StoryGenerationProgress) => queue.splice(0, queue.length, progress);
  return { client, fetchImpl, posts, generationCalls, finish };
}

describe("useStoryGeneration", () => {
  it("starts idle and asks the server once — no polling until a run is live", async () => {
    const h = harness();
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));

    await waitFor(() => expect(result.current.generation.status).toBe("idle"));
    await new Promise((r) => setTimeout(r, 4 * POLL));
    expect(h.generationCalls().length).toBe(1); // idle: one read, then quiet
  });

  it("finds a run that survives a reload, polls it, and lands on ready", async () => {
    const h = harness({
      generation: [
        running("writing", 2, 44),
        running("writing", 2, 48),
        running("checking", 2, 52),
        running("checking", 2, 55),
        { status: "ready", percent: 100, storyId: "st-new" },
      ],
    });
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));

    await waitFor(() => {
      const live = result.current.generation;
      expect(live.status).toBe("running");
      expect(live.status === "running" && live.progress.attempt).toBe(2);
      expect(live.status === "running" && live.progress.maxAttempts).toBe(3);
    });

    await waitFor(() => {
      const ready = result.current.generation;
      expect(ready.status).toBe("ready");
      expect(ready.status === "ready" && ready.progress.storyId).toBe("st-new");
    });

    // Ready is terminal: polling goes quiet again.
    const settled = h.generationCalls().length;
    await new Promise((r) => setTimeout(r, 4 * POLL));
    expect(h.generationCalls().length).toBe(settled);
  });

  it("Generate sends the Learner's genre and theme and tracks the run it starts", async () => {
    const h = harness({
      generate: { status: 202, body: running("preparing", 1, 5) },
      generation: [{ status: "idle", percent: 0 }, running("writing", 1, 30)],
    });
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));
    await waitFor(() => expect(result.current.generation.status).toBe("idle"));

    await act(async () => {
      const out = await result.current.startGeneration({ genre: "travel", theme: "a night train" });
      expect(out.ok).toBe(true);
    });
    expect(h.posts[0]?.body).toMatchObject({ genre: "travel", theme: "a night train" });
    // The run stays "running" until the test finishes it: a timed finish raced this check.
    expect(result.current.generation.status).toBe("running");

    h.finish({ status: "ready", percent: 100, storyId: "st-7" });
    await waitFor(() => expect(result.current.generation.status).toBe("ready"));
    const ready = result.current.generation;
    expect(ready.status === "ready" && ready.progress.storyId).toBe("st-7");
  });

  it("Surprise me sends surprise without typed words", async () => {
    const h = harness();
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));
    await waitFor(() => expect(result.current.generation.status).toBe("idle"));

    await act(async () => {
      const out = await result.current.startGeneration({ surprise: true });
      expect(out.ok).toBe(true);
    });
    expect(h.posts[0]?.body).toMatchObject({ surprise: true });
    const body = h.posts[0]?.body as Record<string, unknown>;
    expect(body.genre ?? "").toBe("");
    expect(body.theme ?? "").toBe("");
  });

  it("a run that cannot fit the Learner's vocabulary fails with the retry line", async () => {
    const message = "Couldn't write a Story that fits your vocabulary. Try again?";
    const h = harness({
      generation: [
        { status: "idle", percent: 0 },
        running("writing", 3, 80),
        { status: "failed", percent: 82, message },
      ],
    });
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));
    await waitFor(() => expect(result.current.generation.status).toBe("idle"));

    await act(async () => {
      await result.current.startGeneration({});
    });
    await waitFor(() => expect(result.current.generation.status).toBe("failed"));
    const failed = result.current.generation;
    expect(failed.status === "failed" && failed.progress.message).toBe(message);
  });

  it("a failed run comes back on reload: the retry offer survives navigation", async () => {
    const message = "Couldn't write a Story that fits your vocabulary. Try again?";
    const h = harness({ generation: [{ status: "failed", percent: 82, message }] });
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));

    await waitFor(() => expect(result.current.generation.status).toBe("failed"));
    const failed = result.current.generation;
    expect(failed.status === "failed" && failed.progress.message).toBe(message);
  });

  it("a second start while one runs is refused, and the running one still shows", async () => {
    const h = harness({
      generate: { status: 409, body: { code: "generation_running", message: "A Story is already being written for you." } },
      generation: [{ status: "idle", percent: 0 }, running("writing", 1, 20)],
    });
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));
    await waitFor(() => expect(result.current.generation.status).toBe("idle"));

    let message = "";
    await act(async () => {
      const out = await result.current.startGeneration({ genre: "history" });
      message = out.ok ? "" : out.message;
    });
    expect(message).toBe("A Story is already being written for you.");
    // The conflict came from the other run (Automatic or On-demand): the
    // poll re-reads the server's state and shows it running.
    await waitFor(() => expect(result.current.generation.status).toBe("running"));
  });

  it("loads the autocomplete suggestions once", async () => {
    const h = harness({ suggestions: { genres: ["mystery", "cyberpunk"], themes: ["a night train"] } });
    const { result } = renderHook(() => useStoryGeneration(h.client, POLL));

    await waitFor(() => expect(result.current.suggestions.genres).toContain("cyberpunk"));
    expect(result.current.suggestions.themes).toEqual(["a night train"]);
  });
});
