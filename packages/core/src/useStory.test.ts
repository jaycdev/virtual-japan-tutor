import type { Story } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NO_READY_STORY, useStory } from "./useStory.ts";
import type { ActionResult } from "./useAiSettings.ts";

function fakeClient() {
  const fetchImpl = vi.fn();
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const noContent = () => new Response(null, { status: 204 });
  return { client, fetchImpl, json, noContent };
}

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "st-1",
    genre: "diary",
    text: "がっこうでべんきょうしました。",
    createdAt: "2026-11-01T09:00:00Z",
    sentences: [
      {
        ja: "がっこうでべんきょうしました。",
        en: "I studied at school.",
        tokens: [
          {
            surface: "がっこう",
            start: 0,
            end: 4,
            reading: "学校",
            entSeq: 990101,
            tag: "known",
            srsLevel: 4,
            showFurigana: false,
          },
          { surface: "で", start: 4, end: 5, reading: "で", tag: "unknown", showFurigana: true },
        ],
        grammarSpans: [
          {
            start: 9,
            end: 13,
            grammarPointId: "12",
            isFocus: false,
            pattern: "～てしまう",
            meaning: "completing something",
            jlptLevel: "N4",
          },
        ],
      },
    ],
    questions: [
      { position: 0, promptJa: "どこで べんきょう しましたか。", optionsJa: ["がっこう", "いえ"] },
      { position: 1, promptJa: "なにを しましたか。", optionsJa: ["べんきょう", "ごはん"] },
      { position: 2, promptJa: "いつ しましたか。", optionsJa: ["きのう", "あした"] },
    ],
    vocabItems: [
      { entSeq: 990101, ja: "学校", en: "school", isKnown: true, isFocus: true },
    ],
    ...overrides,
  };
}

function page(items: Story[], total = items.length) {
  return { items, total, limit: 10, offset: 0 };
}

function settingsBody(overrides: Record<string, unknown> = {}) {
  return { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "", ...overrides };
}

describe("useStory", () => {
  it("loads the library page and the story settings on mount", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story()])))
      .mockImplementationOnce(async () => json(200, settingsBody()));
    const { result } = renderHook(() => useStory(client));

    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    const lib = result.current.library;
    expect(lib.status === "ready" && lib.page.total).toBe(1);
    expect(lib.status === "ready" && lib.page.items[0]?.genre).toBe("diary");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const settingsCall = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(settingsCall.url).toContain("/story-settings");
  });

  it("opens the ready story instantly and refreshes the library", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, page([story()])));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));

    await act(async () => {
      await result.current.openReady();
    });

    expect(result.current.story?.id).toBe("st-1");
    expect(result.current.open).toBe(true);
    expect(result.current.error).toBeNull();
    // GET /stories, GET /story-settings, GET /stories/ready, then the library refresh.
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const readyCall = fetchImpl.mock.calls[2]?.[0] as Request;
    expect(readyCall.url).toContain("/stories/ready");
  });

  it("reports the no-ready-story case as a message, not a failure", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(404, { code: "no_ready_story", message: "no story is ready" }));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));

    await act(async () => {
      await result.current.openReady();
    });

    expect(result.current.error).toBe(NO_READY_STORY);
    expect(result.current.story).toBeNull();
  });

  it("opens a library story by id", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story({ id: "st-old" })])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story({ id: "st-old" })));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));

    await act(async () => {
      await result.current.openStory("st-old");
    });

    expect(result.current.story?.id).toBe("st-old");
    const openCall = fetchImpl.mock.calls[2]?.[0] as Request;
    expect(openCall.url).toContain("/stories/st-old");
  });

  it("answers each question once and keeps the verdict", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, { correct: true, practiceRecorded: true }));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await act(async () => {
      await result.current.openReady();
    });

    await act(async () => {
      await result.current.answer(0, 0);
    });
    expect(result.current.questions[0]?.result).toEqual({ correct: true, practiceRecorded: true });

    // A second attempt for the same question never reaches the server.
    await act(async () => {
      await result.current.answer(0, 1);
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(result.current.questions[0]?.result?.correct).toBe(true);
    // Unanswered questions stay open.
    expect(result.current.questions[1]?.result).toBeNull();
  });

  it("drops an answer verdict that lands after the story was switched", async () => {
    // The verdict POST is in flight; the Learner closes the story and opens
    // another one. The late reply belongs to the story it was asked about,
    // so it must not paint the now-open story's questions or its error.
    const { client, fetchImpl, json } = fakeClient();
    let resolveAnswer: (res: Response) => void = () => {};
    const answerPending = new Promise<Response>((resolve) => {
      resolveAnswer = resolve;
    });
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(() => answerPending)
      .mockImplementationOnce(async () => json(200, story({ id: "st-2" })));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await act(async () => {
      await result.current.openReady();
    });

    let inFlight: Promise<void>;
    act(() => {
      inFlight = result.current.answer(0, 0);
    });
    result.current.close();
    await act(async () => {
      await result.current.openStory("st-2");
    });
    expect(result.current.story?.id).toBe("st-2");

    resolveAnswer(json(200, { correct: true, practiceRecorded: true }));
    await act(async () => {
      await inFlight;
    });

    expect(result.current.story?.id).toBe("st-2");
    expect(result.current.questions[0]?.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("rates a story and shows the rating on the story and the library", async () => {
    const { client, fetchImpl, json, noContent } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story()])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, page([story()])))
      .mockImplementationOnce(async () => noContent());
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await act(async () => {
      await result.current.openReady();
    });

    await act(async () => {
      await result.current.rate("st-1", "up");
    });

    expect(result.current.story?.rating).toBe("up");
    const lib = result.current.library;
    expect(lib.status === "ready" && lib.page.items[0]?.rating).toBe("up");
    const rateCall = fetchImpl.mock.calls[4]?.[0] as Request;
    expect(rateCall.url).toContain("/stories/st-1/rate");
    expect(await rateCall.json()).toBe("up");
  });

  it("pages the library by offset", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story()], 12)))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () =>
        json(200, { items: [story({ id: "st-11" })], total: 12, limit: 10, offset: 10 }),
      );
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));

    await act(async () => {
      await result.current.loadPage(10);
    });

    await waitFor(() => {
      const lib = result.current.library;
      expect(lib.status === "ready" && lib.page.offset).toBe(10);
      expect(lib.status === "ready" && lib.page.items[0]?.id).toBe("st-11");
    });
    const secondCall = fetchImpl.mock.calls[2]?.[0] as Request;
    expect(secondCall.url).toContain("offset=10");
  });

  it("surfaces unreachable server as an error", async () => {
    const { client, fetchImpl } = fakeClient();
    fetchImpl.mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("error"));
    expect(result.current.library.status === "error" && result.current.library.message).toBe(
      "Cannot reach the server",
    );
  });

  it("loads the story settings on mount", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, settingsBody({ preferredGenre: "mystery" })));
    const { result } = renderHook(() => useStory(client));

    await waitFor(() => expect(result.current.settings.status).toBe("ready"));
    const s = result.current.settings;
    expect(s.status === "ready" && s.settings.furiganaThresholdSrsLevel).toBe(3);
    expect(s.status === "ready" && s.settings.preferredGenre).toBe("mystery");
  });

  it("saves settings and adopts the server's answer", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () =>
        json(200, settingsBody({ furiganaThresholdSrsLevel: 7, preferredGenre: "mystery", preferredTheme: "robots" })),
      );
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.settings.status).toBe("ready"));

    let outcome: ActionResult | undefined;
    await act(async () => {
      outcome = await result.current.saveSettings({
        furiganaThresholdSrsLevel: 7,
        preferredGenre: "mystery",
        preferredTheme: "robots",
      });
    });
    expect(outcome).toEqual({ ok: true });
    const s = result.current.settings;
    expect(s.status === "ready" && s.settings.furiganaThresholdSrsLevel).toBe(7);
    expect(s.status === "ready" && s.settings.preferredGenre).toBe("mystery");
    const putCall = fetchImpl.mock.calls[2]?.[0] as Request;
    expect(putCall.method).toBe("PUT");
    expect(putCall.url).toContain("/story-settings");
    expect(await putCall.json()).toEqual({
      furiganaThresholdSrsLevel: 7,
      preferredGenre: "mystery",
      preferredTheme: "robots",
    });
  });

  it("surfaces a rejected settings save and keeps the stored settings", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () =>
        json(400, { code: "invalid_preference", message: "preferred genre is too long" }),
      );
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.settings.status).toBe("ready"));

    let outcome: ActionResult | undefined;
    await act(async () => {
      outcome = await result.current.saveSettings({
        furiganaThresholdSrsLevel: 3,
        preferredGenre: "x".repeat(200),
        preferredTheme: "",
      });
    });
    expect(outcome).toEqual({ ok: false, message: "preferred genre is too long" });
    const s = result.current.settings;
    expect(s.status === "ready" && s.settings.preferredGenre).toBe("");
  });

  it("reloads settings after a load error", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => json(500, { code: "internal", message: "boom" }))
      .mockImplementationOnce(async () => json(200, settingsBody()));
    const { result } = renderHook(() => useStory(client));

    await waitFor(() => expect(result.current.settings.status).toBe("error"));
    expect(result.current.settings.status === "error" && result.current.settings.message).toBe("boom");

    await act(async () => {
      result.current.reloadSettings();
    });
    await waitFor(() => expect(result.current.settings.status).toBe("ready"));
    const settingsCalls = fetchImpl.mock.calls.filter(([req]) =>
      (req as Request).url.includes("/story-settings"),
    );
    expect(settingsCalls.length).toBe(2);
  });
});
