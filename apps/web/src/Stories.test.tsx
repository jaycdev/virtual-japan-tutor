import { createApiClient } from "@vjt/api-client";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Stories } from "./Stories.tsx";

afterEach(cleanup);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A stateful fake of the Story API (issue #10). `requests` records method,
 * path and body so the test can assert what the screen sent and when — in
 * particular that opening a story is a plain storage read, never a generation.
 */
function fakeApi(opts: { ready?: boolean; stories?: unknown[] } = {}) {
  const hasReady = opts.ready ?? true;
  const storyView = {
    id: "st-1",
    genre: "diary",
    text: "がっこうでべんきょうしました。",
    createdAt: "2026-11-01T09:00:00Z",
    attempts: 1,
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
          { surface: "しました", start: 9, end: 13, reading: "しました", tag: "unknown", showFurigana: true },
        ],
        grammarSpans: [{ start: 9, end: 13, grammarPointId: "12" }],
      },
    ],
    questions: [
      { position: 0, promptJa: "どこで べんきょう しましたか。", optionsJa: ["がっこう", "いえ"] },
    ],
    vocabItems: [{ entSeq: 990101, ja: "学校", en: "school", isKnown: true, isFocus: true }],
  };
  const page = {
    items: opts.stories ?? [storyView],
    total: (opts.stories ?? [storyView]).length,
    limit: 10,
    offset: 0,
  };

  const requests: { method: string; path: string; body: unknown }[] = [];
  const settings = { furiganaThresholdSrsLevel: 3, preferredGenre: "", preferredTheme: "" };
  const fetchImpl = vi.fn(async (request: Request) => {
    const { pathname } = new URL(request.url);
    const body = request.body ? await request.json() : null;
    requests.push({ method: request.method, path: pathname, body });
    if (pathname === "/stories" && request.method === "GET") return json(200, page);
    if (pathname === "/stories/ready" && request.method === "GET") {
      return hasReady ? json(200, storyView) : json(404, { code: "no_ready_story", message: "no story ready" });
    }
    if (pathname === "/stories/st-1" && request.method === "GET") return json(200, storyView);
    if (pathname === "/stories/st-1/rate" && request.method === "POST") return new Response(null, { status: 204 });
    if (pathname === "/stories/st-1/answers" && request.method === "POST")
      return json(200, { correct: true, practiceRecorded: true });
    if (pathname === "/story-settings" && request.method === "GET") return json(200, settings);
    if (pathname === "/story-settings" && request.method === "PUT") {
      Object.assign(settings, body as Partial<typeof settings>);
      return json(200, settings);
    }
    return json(404, { code: "not_found", message: "not found" });
  });
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  return { client, requests };
}

describe("Stories screen", () => {
  it("lists the library and opens a story with furigana and translations", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);

    expect(await screen.findByRole("button", { name: "diary" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "diary" }));
    expect(await screen.findByText("I studied at school.")).toBeTruthy();
    // Furigana only where the server's showFurigana says so: がっこう is a
    // solid Known Item (no ruby), で and しました carry readings.
    const rtTexts = Array.from(document.querySelectorAll("ruby rt")).map((rt) => rt.textContent);
    expect(rtTexts).toEqual(["で", "しました"]);
    // One GET for the library, one for the story settings, one for the
    // opened story; nothing else — no generation call.
    await waitFor(() => expect(requests.length).toBe(3));
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      "GET /stories",
      "GET /story-settings",
      "GET /stories/st-1",
    ]);
  });

  it("opens the ready story instantly and answers a comprehension question once", async () => {
    const { client, requests } = fakeApi();
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    fireEvent.click(screen.getByRole("button", { name: "Read today's story" }));
    expect(await screen.findByRole("heading", { name: /diary/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "がっこう" }));
    expect(await screen.findByText(/Correct/)).toBeTruthy();
    expect(screen.getByText(/practised your focus words/)).toBeTruthy();
    // The question is locked after the single answer.
    expect((screen.getByRole("button", { name: "いえ" }) as HTMLButtonElement).disabled).toBe(true);

    const answer = requests.find((r) => r.path === "/stories/st-1/answers");
    expect(answer?.body).toEqual({ questionIndex: 0, answerIndex: 0 });
    // Opening came from storage: GET /stories/ready, not any generate endpoint.
    expect(requests.some((r) => r.path === "/stories/ready")).toBe(true);
  });

  it("says when no story is ready", async () => {
    const { client } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    fireEvent.click(screen.getByRole("button", { name: "Read today's story" }));
    expect(await screen.findByText(/No story is ready yet/)).toBeTruthy();
  });

  it("rates a story from the library and marks the button", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    const thumbs = screen.getAllByRole("button", { name: "👍" });
    const thumb = thumbs[0] as HTMLButtonElement;
    fireEvent.click(thumb);
    await waitFor(() => expect(thumb.getAttribute("aria-pressed")).toBe("true"));
    const rate = requests.find((r) => r.path === "/stories/st-1/rate");
    expect(rate?.body).toBe("up");
  });

  it("shows and saves the story settings", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    const threshold = screen.getByLabelText(/Furigana threshold/) as HTMLInputElement;
    const genre = screen.getByLabelText(/Preferred genre/) as HTMLInputElement;
    expect(threshold.value).toBe("3");
    expect(genre.value).toBe("");

    fireEvent.change(threshold, { target: { value: "7" } });
    fireEvent.change(genre, { target: { value: "mystery" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Saved — future stories will aim for these/)).toBeTruthy();
    const put = requests.find((r) => r.path === "/story-settings" && r.method === "PUT");
    expect(put?.body).toEqual({ furiganaThresholdSrsLevel: 7, preferredGenre: "mystery", preferredTheme: "" });
    // The fields show what the server stored, not a cleared form.
    await waitFor(() => expect(genre.value).toBe("mystery"));
    expect(threshold.value).toBe("7");
  });

  it("keeps an empty furigana threshold off the wire", async () => {
    const { client, requests } = fakeApi({ ready: false });
    render(<Stories client={client} />);
    await screen.findByRole("button", { name: "diary" });

    const threshold = screen.getByLabelText(/Furigana threshold/) as HTMLInputElement;
    // An empty field passes HTML validation (min/max only bound filled
    // values), so this checks the form's own guard before any PUT.
    fireEvent.change(threshold, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/whole number from 1 to 9/)).toBeTruthy();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });
});
