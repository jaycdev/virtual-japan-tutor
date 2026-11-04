import type { Story } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useStory } from "./useStory.ts";
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
  const noStory = () => json(404, { code: "no_story", message: "no automatic story yet" });
  return { client, fetchImpl, json, noContent, noStory };
}

function story(overrides: Partial<Story> = {}): Story {
  return {
    id: "st-1",
    title: "学校での勉強",
    origin: "automatic",
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
  return {
    furiganaThresholdSrsLevel: 3,
    preferredGenre: "",
    preferredTheme: "",
    timezone: "",
    ...overrides,
  };
}

describe("useStory", () => {
  it("loads the library page, Today's Story and the settings on mount", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story()])))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, settingsBody()));
    const { result } = renderHook(() => useStory(client));

    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await waitFor(() => expect(result.current.today.status).toBe("story"));
    const lib = result.current.library;
    expect(lib.status === "ready" && lib.page.total).toBe(1);
    expect(lib.status === "ready" && lib.page.items[0]?.genre).toBe("diary");
    const today = result.current.today;
    expect(today.status === "story" && today.story.id).toBe("st-1");
    // Today's Story comes from storage: GET /stories/today, never a generate endpoint.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const todayCall = fetchImpl.mock.calls[1]?.[0] as Request;
    expect(todayCall.url).toContain("/stories/today");
    const settingsCall = fetchImpl.mock.calls[2]?.[0] as Request;
    expect(settingsCall.url).toContain("/story-settings");
  });

  it("reports no Automatic Story as none, not a failure", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()));
    const { result } = renderHook(() => useStory(client));

    await waitFor(() => expect(result.current.today.status).toBe("none"));
    expect(result.current.error).toBeNull();
    expect(result.current.story).toBeNull();
  });

  it("reloads Today's Story when asked", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.today.status).toBe("none"));

    await act(async () => {
      result.current.reloadToday();
    });

    await waitFor(() => expect(result.current.today.status).toBe("story"));
    const todayCalls = fetchImpl.mock.calls.filter(([req]) =>
      (req as Request).url.includes("/stories/today"),
    );
    expect(todayCalls.length).toBe(2);
  });

  it("opens a library story by id", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story({ id: "st-old" })])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story({ id: "st-old" })));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));

    await act(async () => {
      await result.current.openStory("st-old");
    });

    expect(result.current.story?.id).toBe("st-old");
    const openCall = fetchImpl.mock.calls[3]?.[0] as Request;
    expect(openCall.url).toContain("/stories/st-old");
  });

  it("answers each question once and keeps the verdict", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, { correct: true, practiceRecorded: true }));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await act(async () => {
      await result.current.openStory("st-1");
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
    const { client, fetchImpl, json, noStory } = fakeClient();
    let resolveAnswer: (res: Response) => void = () => {};
    const answerPending = new Promise<Response>((resolve) => {
      resolveAnswer = resolve;
    });
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(() => answerPending)
      .mockImplementationOnce(async () => json(200, story({ id: "st-2" })));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await act(async () => {
      await result.current.openStory("st-1");
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

  it("ignores an openStory reply that lands after a newer openStory (out of order)", async () => {
    // Previous/Next hammered in the reader: B is asked for, then C. B's reply
    // lands after C's. If it painted, the reader would show B while the URL
    // says C; if it errored or cleared pending, the reader would stick on a
    // skeleton while C is still in flight (issue #77 review).
    const { client, fetchImpl, json, noStory } = fakeClient();
    let resolveB: (res: Response) => void = () => {};
    const bPending = new Promise<Response>((resolve) => {
      resolveB = resolve;
    });
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(() => bPending)
      .mockImplementationOnce(async () => json(200, story({ id: "st-c" })));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));

    let bInFlight: Promise<void>;
    act(() => {
      bInFlight = result.current.openStory("st-b");
    });
    await act(async () => {
      await result.current.openStory("st-c");
    });
    expect(result.current.story?.id).toBe("st-c");
    expect(result.current.error).toBeNull();

    // The stale B reply arrives late — including as a failure, which must not
    // error the now-open C either.
    resolveB(json(500, { message: "the server is busy" }));
    await act(async () => {
      await bInFlight;
    });
    expect(result.current.story?.id).toBe("st-c");
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it("ignores an openStory failure that lands after a newer openStory", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    let rejectB: (err: unknown) => void = () => {};
    const bPending = new Promise<Response>((_resolve, reject) => {
      rejectB = reject;
    });
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(() => bPending)
      .mockImplementationOnce(async () => json(200, story({ id: "st-c" })));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));

    let bInFlight: Promise<void>;
    act(() => {
      bInFlight = result.current.openStory("st-b");
    });
    await act(async () => {
      await result.current.openStory("st-c");
    });

    rejectB(new TypeError("Failed to fetch"));
    await act(async () => {
      await bInFlight;
    });
    expect(result.current.story?.id).toBe("st-c");
    expect(result.current.error).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it("rates a story and shows the rating on the story, the library and Today's Story", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story()])))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => new Response(null, { status: 204 }));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.today.status).toBe("story"));
    await act(async () => {
      await result.current.openStory("st-1");
    });

    await act(async () => {
      await result.current.rate("st-1", "up");
    });

    expect(result.current.story?.rating).toBe("up");
    const lib = result.current.library;
    expect(lib.status === "ready" && lib.page.items[0]?.rating).toBe("up");
    const today = result.current.today;
    expect(today.status === "story" && today.story.rating).toBe("up");
    const rateCall = fetchImpl.mock.calls[4]?.[0] as Request;
    expect(rateCall.url).toContain("/stories/st-1/rate");
    expect(await rateCall.json()).toBe("up");
  });

  it("marks a library story Read and shows the mark on the story and the page", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story()])))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => new Response(null, { status: 204 }));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await act(async () => {
      await result.current.openStory("st-1");
    });
    expect(result.current.story?.readAt).toBeUndefined();

    await act(async () => {
      await result.current.setRead("st-1");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.story?.readAt).toBeTruthy();
    const lib = result.current.library;
    expect(lib.status === "ready" && lib.page.items[0]?.readAt).toBeTruthy();
    const today = result.current.today;
    expect(today.status === "story" && today.story.readAt).toBeTruthy();
    const readCall = fetchImpl.mock.calls[4]?.[0] as Request;
    expect(readCall.method).toBe("PUT");
    expect(readCall.url).toContain("/stories/st-1/read");
  });

  it("unmarks a Read story so the library shows it unread again", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story({ readAt: "2026-11-01T10:00:00Z" })])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => new Response(null, { status: 204 }));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    const before = result.current.library;
    expect(before.status === "ready" && before.page.items[0]?.readAt).toBeTruthy();

    await act(async () => {
      await result.current.clearRead("st-1");
    });

    expect(result.current.error).toBeNull();
    const lib = result.current.library;
    expect(lib.status === "ready" && lib.page.items[0]?.readAt).toBeUndefined();
    const clearCall = fetchImpl.mock.calls[3]?.[0] as Request;
    expect(clearCall.method).toBe("DELETE");
    expect(clearCall.url).toContain("/stories/st-1/read");
  });

  it("deletes a story: the row leaves the page, the total drops, and an open story closes", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story(), story({ id: "st-2" })], 2)))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => json(200, story()))
      .mockImplementationOnce(async () => new Response(null, { status: 204 }));
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.library.status).toBe("ready"));
    await act(async () => {
      await result.current.openStory("st-1");
    });

    await act(async () => {
      await result.current.removeStory("st-1");
    });

    expect(result.current.error).toBeNull();
    const lib = result.current.library;
    expect(lib.status === "ready" && lib.page.items.map((s) => s.id)).toEqual(["st-2"]);
    expect(lib.status === "ready" && lib.page.total).toBe(1);
    expect(result.current.story).toBeNull();
    const delCall = fetchImpl.mock.calls[4]?.[0] as Request;
    expect(delCall.method).toBe("DELETE");
    expect(delCall.url).toContain("/stories/st-1");
  });

  it("handing the day over: deleting Today's Story falls back to the older Automatic Story", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story(), story({ id: "st-2" })], 2)))
      .mockImplementationOnce(async () => json(200, story())) // today = st-1
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () => new Response(null, { status: 204 })) // delete st-1
      .mockImplementationOnce(async () => json(200, story({ id: "st-2" }))); // today = st-2
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.today.status).toBe("story"));

    await act(async () => {
      await result.current.removeStory("st-1");
    });

    await waitFor(() => {
      const today = result.current.today;
      expect(today.status === "story" && today.story.id).toBe("st-2");
    });
    const todayCalls = fetchImpl.mock.calls.filter(([req]) =>
      (req as Request).url.includes("/stories/today"),
    );
    expect(todayCalls.length).toBe(2);
  });

  it("pages the library by offset", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([story()], 12)))
      .mockImplementationOnce(async () => noStory())
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
    const secondCall = fetchImpl.mock.calls[3]?.[0] as Request;
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
    await waitFor(() => expect(result.current.today.status).toBe("error"));
  });

  it("loads the story settings on mount", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody({ preferredGenre: "mystery" })));
    const { result } = renderHook(() => useStory(client));

    await waitFor(() => expect(result.current.settings.status).toBe("ready"));
    const s = result.current.settings;
    expect(s.status === "ready" && s.settings.furiganaThresholdSrsLevel).toBe(3);
    expect(s.status === "ready" && s.settings.preferredGenre).toBe("mystery");
  });

  it("saves settings and adopts the server's answer", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
      .mockImplementationOnce(async () => json(200, settingsBody()))
      .mockImplementationOnce(async () =>
        json(
          200,
          settingsBody({
            furiganaThresholdSrsLevel: 7,
            preferredGenre: "mystery",
            preferredTheme: "robots",
            timezone: "Asia/Tokyo",
          }),
        ),
      );
    const { result } = renderHook(() => useStory(client));
    await waitFor(() => expect(result.current.settings.status).toBe("ready"));

    let outcome: ActionResult | undefined;
    await act(async () => {
      outcome = await result.current.saveSettings({
        furiganaThresholdSrsLevel: 7,
        preferredGenre: "mystery",
        preferredTheme: "robots",
        timezone: "Asia/Tokyo",
      });
    });
    expect(outcome).toEqual({ ok: true });
    const s = result.current.settings;
    expect(s.status === "ready" && s.settings.furiganaThresholdSrsLevel).toBe(7);
    expect(s.status === "ready" && s.settings.preferredGenre).toBe("mystery");
    expect(s.status === "ready" && s.settings.timezone).toBe("Asia/Tokyo");
    const putCall = fetchImpl.mock.calls[3]?.[0] as Request;
    expect(putCall.method).toBe("PUT");
    expect(putCall.url).toContain("/story-settings");
    expect(await putCall.json()).toEqual({
      furiganaThresholdSrsLevel: 7,
      preferredGenre: "mystery",
      preferredTheme: "robots",
      timezone: "Asia/Tokyo",
    });
  });

  it("surfaces a rejected settings save and keeps the stored settings", async () => {
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
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
    const { client, fetchImpl, json, noStory } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(200, page([])))
      .mockImplementationOnce(async () => noStory())
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
