import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { createApiClient } from "@vjt/api-client";
import { displayPrompt, practiceSeedForStory } from "@vjt/core";

import { Practice, destinationForItem } from "./Practice.tsx";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface SessionShape {
  id: string;
  state: "active" | "complete";
  targetSize: number;
  skipped: number;
  exercises: {
    id: string;
    kind: string;
    instruction: string;
    prompt: string;
    options: { id: string; text: string }[];
    answered: boolean;
    chosenOptionId?: string;
    correctOptionId?: string;
    correct?: boolean;
  }[];
  results?: { correct: number; total: number; items: { itemKind: string; itemRef: string; correct: boolean }[] };
}

function freshSession(): SessionShape {
  return {
    id: "practice-1",
    state: "active",
    targetSize: 2,
    skipped: 0,
    exercises: [
      {
        id: "ex-1",
        kind: "recognition",
        instruction: "What does this mean?",
        prompt: "学",
        options: [
          { id: "o-learn", text: "learn" },
          { id: "o-tree", text: "tree" },
        ],
        answered: false,
      },
      {
        id: "ex-2",
        kind: "recognition",
        instruction: "What does this mean?",
        prompt: "水",
        options: [
          { id: "o-water", text: "water" },
          { id: "o-tree", text: "tree" },
        ],
        answered: false,
      },
    ],
  };
}

describe("Practice (web)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let session: SessionShape;
  // openapi-fetch hands fetch a Request whose body the stub consumes, so the
  // stub itself records what was sent for later assertions.
  let posts: { path: string; body?: unknown }[];

  beforeEach(() => {
    session = freshSession();
    posts = [];
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/practice/sessions") {
        posts.push({ path, body: await request.json() });
        session = freshSession();
        return jsonResponse(session);
      }
      if (request.method === "POST" && path === "/practice/sessions/practice-1/answers") {
        const body = (await request.json()) as { exerciseId: string; optionId: string };
        posts.push({ path, body });
        const ex = session.exercises.find((e) => e.id === body.exerciseId);
        if (!ex || ex.answered) return jsonResponse({ message: "already_answered" }, 409);
        const correctOptionId = ex.id === "ex-1" ? "o-learn" : "o-water";
        ex.answered = true;
        ex.chosenOptionId = body.optionId;
        ex.correctOptionId = correctOptionId;
        ex.correct = body.optionId === correctOptionId;
        const allAnswered = session.exercises.every((e) => e.answered);
        if (allAnswered) {
          session.state = "complete";
          session.results = {
            correct: session.exercises.filter((e) => e.correct).length,
            total: session.exercises.length,
            items: session.exercises.map((e) => ({
              itemKind: "kanji",
              itemRef: e.prompt,
              correct: e.correct === true,
            })),
          };
        }
        return jsonResponse({ correct: ex.correct, correctOptionId });
      }
      if (request.method === "GET" && path === "/practice/sessions/practice-1") {
        return jsonResponse(session);
      }
      return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
    });
  });

  function makeClient() {
    return createApiClient({
      baseUrl: "http://localhost",
      fetch: fetchMock as unknown as typeof fetch,
    });
  }

  function renderPractice(seed?: number) {
    return render(
      <MemoryRouter>
        <Practice client={makeClient()} seed={seed} />
      </MemoryRouter>,
    );
  }

  const postCalls = (pathPart: string) => posts.filter((p) => p.path.includes(pathPart));
  const startCalls = () => posts.filter((p) => p.path === "/practice/sessions");
  const startSession = () => fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));

  it("starts idle and only asks for a session on Start", async () => {
    renderPractice();

    expect(screen.getByRole("button", { name: "Start a practice session" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    startSession();

    await waitFor(() => {
      expect(startCalls()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });
    // No answer state before the Learner picks: no feedback, no markers.
    expect(screen.getByText("学")).toBeTruthy();
    expect(screen.queryByText(/Correct|Not quite/)).toBeNull();
    expect(posts).toHaveLength(1);
  });

  it("reveals no correct option before answering", async () => {
    renderPractice();
    startSession();
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });

    // Option labels are plain text until feedback lands.
    expect(screen.getByRole("button", { name: "learn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "tree" })).toBeTruthy();
  });

  it("records the answer, locks the options, and advances on Continue", async () => {
    renderPractice();
    startSession();
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "learn" }));

    await waitFor(() => {
      expect(postCalls("/answers")).toHaveLength(1);
    });
    expect(postCalls("/answers")[0]?.body).toEqual({ exerciseId: "ex-1", optionId: "o-learn" });

    await waitFor(() => {
      expect(screen.getByText("Correct")).toBeTruthy();
    });
    // While Exercise 1's feedback is up, the progress line still names it.
    expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    expect(screen.queryByText("Exercise 2 of 2")).toBeNull();
    // The option keeps its plain label; the feedback line carries the truth.
    expect(screen.getByRole("button", { name: "learn" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    // The verdict announces itself politely...
    const verdict = screen.getByText("Correct").closest('[role="status"]');
    expect(verdict?.getAttribute("aria-live")).toBe("polite");
    // ...and focus lands on Continue, the control that advances the session.
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe("Continue");
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Exercise 2 of 2")).toBeTruthy();
    });
    expect(screen.getByText("水")).toBeTruthy();
    expect(screen.queryByText("Correct")).toBeNull();
  });

  it("blocks a double click from posting the same answer twice", async () => {
    renderPractice();
    startSession();
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "learn" }));
    fireEvent.click(screen.getByRole("button", { name: "learn" }));

    await waitFor(() => {
      expect(screen.getByText("Correct")).toBeTruthy();
    });
    expect(postCalls("/answers")).toHaveLength(1);
  });

  it("keeps the last feedback up, then shows results on Continue", async () => {
    renderPractice();
    startSession();
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "learn" }));
    await waitFor(() => {
      expect(screen.getByText("Correct")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // water is the right answer for the second exercise, so tree is the wrong pick.
    fireEvent.click(screen.getByRole("button", { name: "tree" }));

    // A miss names the right answer in the feedback line.
    await waitFor(() => {
      expect(screen.getByText("Not quite. Correct answer: water")).toBeTruthy();
    });
    // The session is done but the final exercise stays visible until Continue.
    expect(screen.queryByText(/Session complete/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Session complete" })).toBeTruthy();
    });
    // The heading and the score line are separate, and the score line counts the exercises.
    expect(screen.getByText(/1 of 2 correct - 2 exercises from your Focus Set\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Practice again" })).toBeTruthy();
    // The summary lists the items needing another look: the missed exercise's
    // sentence, the option that was right, and the kind in words a Learner
    // would recognise, not the raw API token.
    expect(screen.getByText("Needs another look")).toBeTruthy();
    expect(screen.getByText("水")).toBeTruthy();
    expect(screen.getByText("Correct answer: water")).toBeTruthy();
    expect(screen.getByText("Kanji")).toBeTruthy();
    expect(screen.queryByText("kanji")).toBeNull();
  });

  it("an empty Focus Set gets one clear next step, not a stuck session", async () => {
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      posts.push({ path: new URL(request.url).pathname, body: await request.json() });
      return jsonResponse({ id: "practice-1", state: "active", targetSize: 0, skipped: 0, exercises: [] });
    });
    renderPractice();

    startSession();

    await waitFor(() => {
      expect(screen.getByText("Nothing in your Focus Set to practise yet")).toBeTruthy();
    });
    expect(screen.queryByText(/Exercise \d of/)).toBeNull();
    expect(screen.queryByText("The next exercise is on its way…")).toBeNull();
    // One action, and it goes somewhere useful.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Open your Item Lists" }).getAttribute("href")).toBe("/settings/lists");
  });

  it("a completed session with no exercises shows the empty state, not a 0-of-0 card", async () => {
    fetchMock.mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      posts.push({ path: new URL(request.url).pathname, body: await request.json() });
      return jsonResponse({
        id: "practice-1",
        state: "complete",
        targetSize: 0,
        skipped: 0,
        exercises: [],
        results: { correct: 0, total: 0, items: [] },
      });
    });
    renderPractice();

    startSession();

    await waitFor(() => {
      expect(screen.getByText("Nothing in your Focus Set to practise yet")).toBeTruthy();
    });
    expect(screen.queryByText(/Session complete/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Practice again" })).toBeNull();
  });

  it("deep-linked from a Story: starts on arrival, seeded from the Story id", async () => {
    const seed = practiceSeedForStory("st-1");
    renderPractice(seed);

    // No Start tap: the session begins on mount, seeded from the Story.
    await waitFor(() => {
      expect(startCalls()).toHaveLength(1);
    });
    expect(startCalls()[0]?.body).toEqual({ seed });
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: "Start a practice session" })).toBeNull();
  });

  it("a new Story seed on the same screen starts that session instead", async () => {
    const seedA = practiceSeedForStory("st-1");
    const seedB = practiceSeedForStory("st-2");
    const client = makeClient();
    const view = render(
      <MemoryRouter>
        <Practice client={client} seed={seedA} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(startCalls()).toHaveLength(1);
    });
    expect(startCalls()[0]?.body).toEqual({ seed: seedA });

    // A different Story's link while Practice is mounted: the screen must
    // restart with the new seed, not keep the old session.
    view.rerender(
      <MemoryRouter>
        <Practice client={client} seed={seedB} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(startCalls()).toHaveLength(2);
    });
    expect(startCalls()[1]?.body).toEqual({ seed: seedB });
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });
  });

  it("Practice again re-runs the seeded session the deep link asked for", async () => {
    const seed = practiceSeedForStory("st-1");
    renderPractice(seed);

    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "learn" }));
    await waitFor(() => {
      expect(screen.getByText("Correct")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(screen.getByText("Exercise 2 of 2")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "water" }));
    await waitFor(() => {
      expect(screen.getByText("Correct")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Practice again" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Practice again" }));

    await waitFor(() => {
      expect(startCalls()).toHaveLength(2);
    });
    // Same seed as the deep link: the Story link stays reproducible through a retry.
    expect(startCalls()[1]?.body).toEqual({ seed });
  });

  it("keeps each cloze blank whole in a nowrap span, apart from the text around it", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({
        id: "practice-1",
        state: "active",
        targetSize: 1,
        skipped: 0,
        exercises: [
          {
            id: "ex-1",
            kind: "grammar",
            instruction: "Which pattern completes the sentence?",
            prompt: "みせに いきました ＿＿＿。",
            options: [{ id: "o-a", text: "ました" }],
            answered: false,
          },
        ],
      }),
    );
    renderPractice();
    startSession();

    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 1")).toBeTruthy();
    });
    // The span holds the blank alone; displayPrompt's word joiners sit in the text around it.
    const blank = document.querySelector("p[lang='ja'] span.whitespace-nowrap");
    expect(blank?.textContent).toBe("＿＿＿");
    expect(document.querySelector("p[lang='ja']")?.textContent).toBe("みせに いきました ⁠＿＿＿⁠。");
  });

  it("cloze blanks stay glued to their punctuation at narrow widths", () => {
    const joined = displayPrompt("みせに いきました ＿＿＿。");
    // U+2060 WORD JOINER forbids a line break where it sits.
    expect(joined).toContain("＿＿＿⁠。");
    expect(joined).toContain(" ⁠＿＿＿");
    expect(displayPrompt("学校")).toBe("学校");
  });

  it("shows a start failure and stays retryable with the same seed", async () => {
    const seed = practiceSeedForStory("st-1");
    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: "your Focus Set is empty" }, 404));
    renderPractice(seed);

    await waitFor(() => {
      expect(screen.getByText("your Focus Set is empty")).toBeTruthy();
    });
    expect(screen.getByRole("alert").textContent).toContain("your Focus Set is empty");
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a practice session" })).toBeTruthy();

    // The failing start above was a one-off stub and is not recorded, so the
    // retry is the one recorded start, and it carries the same seed.
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => {
      expect(startCalls()).toHaveLength(1);
    });
    expect(startCalls()[0]?.body).toEqual({ seed });
  });

  it("a failed answer shows an inline Retry that re-posts the choice", async () => {
    renderPractice();
    startSession();
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });

    fetchMock.mockImplementationOnce(async () => jsonResponse({ message: "practice is having trouble" }, 500));
    fireEvent.click(screen.getByRole("button", { name: "learn" }));

    // The failure lands in the active card with an explicit Retry, and the
    // exercise is still open (no feedback was recorded).
    await waitFor(() => {
      expect(screen.getByText("practice is having trouble")).toBeTruthy();
    });
    expect(screen.queryByText("Correct")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    // The one-off failing stub did not go through the recorder, so the recorded
    // answer POST is the re-post.
    const answerPosts = fetchMock.mock.calls.filter(([input, init]) => {
      const url = input instanceof Request ? input.url : typeof input === "string" ? input : String(input);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      return method === "POST" && url.includes("/answers");
    });
    await waitFor(() => {
      expect(answerPosts).toHaveLength(2);
    });
    expect(postCalls("/answers")[0]?.body).toEqual({ exerciseId: "ex-1", optionId: "o-learn" });
    await waitFor(() => {
      expect(screen.getByText("Correct")).toBeTruthy();
    });
    expect(screen.queryByText("practice is having trouble")).toBeNull();
  });

  it("a failed session refresh keeps the feedback and Continue retries the GET", async () => {
    // The answer POST succeeds but the follow-up session GET fails, then
    // recovers: the card must stay usable, not loop the answered exercise.
    let refreshAttempts = 0;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/practice/sessions") {
        posts.push({ path, body: await request.json() });
        session = freshSession();
        return jsonResponse(session);
      }
      if (request.method === "POST" && path === "/practice/sessions/practice-1/answers") {
        const body = (await request.json()) as { exerciseId: string; optionId: string };
        posts.push({ path, body });
        const ex = session.exercises.find((e) => e.id === body.exerciseId)!;
        ex.answered = true;
        ex.chosenOptionId = body.optionId;
        ex.correctOptionId = "o-learn";
        ex.correct = true;
        return jsonResponse({ correct: true, correctOptionId: "o-learn" });
      }
      if (request.method === "GET" && path === "/practice/sessions/practice-1") {
        refreshAttempts += 1;
        if (refreshAttempts === 1) return jsonResponse({ message: "sync hiccup" }, 500);
        return jsonResponse(session);
      }
      return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
    });

    renderPractice();
    startSession();
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "learn" }));

    // Feedback from the local record, the refresh failure named beside it.
    await waitFor(() => {
      expect(screen.getByText("sync hiccup")).toBeTruthy();
    });
    expect(screen.getByText("Correct")).toBeTruthy();
    expect(refreshAttempts).toBe(1);

    // Continue while out of step retries the GET first, and advances once the
    // session is back in step.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(refreshAttempts).toBe(2);
    });
    await waitFor(() => {
      expect(screen.getByText("Exercise 2 of 2")).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText("sync hiccup")).toBeNull();
    });
  });

  it("links a missed grammar item to its Grammar Point and a word to the Item Lists", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (request.method === "POST" && path === "/practice/sessions") {
        return jsonResponse({
          id: "practice-1",
          state: "active",
          targetSize: 1,
          skipped: 0,
          exercises: [
            {
              id: "ex-g",
              kind: "grammar",
              instruction: "Which pattern completes the sentence?",
              prompt: "これは本＿＿＿。",
              options: [
                { id: "o-a", text: "です" },
                { id: "o-b", text: "ます" },
              ],
              answered: false,
            },
          ],
        });
      }
      if (request.method === "POST" && path === "/practice/sessions/practice-1/answers") {
        return jsonResponse({ correct: false, correctOptionId: "o-a" });
      }
      if (request.method === "GET" && path === "/practice/sessions/practice-1") {
        return jsonResponse({
          id: "practice-1",
          state: "complete",
          targetSize: 1,
          skipped: 0,
          exercises: [
            {
              id: "ex-g",
              kind: "grammar",
              instruction: "Which pattern completes the sentence?",
              prompt: "これは本＿＿＿。",
              options: [
                { id: "o-a", text: "です" },
                { id: "o-b", text: "ます" },
              ],
              answered: true,
              chosenOptionId: "o-b",
              correctOptionId: "o-a",
              correct: false,
            },
          ],
          results: {
            correct: 0,
            total: 1,
            items: [{ itemKind: "grammar", itemRef: "gp-42", correct: false }],
          },
        });
      }
      return jsonResponse({ message: `stub: unexpected ${request.method} ${path}` }, 500);
    });
    renderPractice();
    startSession();
    await waitFor(() => {
      expect(screen.getByText("Exercise 1 of 1")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "ます" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Session complete" })).toBeTruthy();
    });
    const grammarLink = screen.getByRole("link", { name: /これは本/ });
    expect(grammarLink.getAttribute("href")).toBe("/grammar/gp-42");
    // The name says where the link goes, not just what it is.
    expect(grammarLink.textContent).toMatch(/Open Grammar Point$/);
    expect(destinationForItem("grammar", "gp-42")).toEqual({ to: "/grammar/gp-42", label: "Open Grammar Point" });
    expect(destinationForItem("vocabulary", "1234")).toEqual({ to: "/settings/lists", label: "Open Item Lists" });
  });

  describe("keyboard", () => {
    it("completes a whole Practice Session with the keyboard alone", async () => {
      const user = userEvent.setup();
      renderPractice();

      screen.getByRole("button", { name: "Start a practice session" }).focus();
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
      });
      // The first option of a new Exercise has focus.
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "learn" }));

      // Number key 1 chooses learn, which is right.
      await user.keyboard("1");
      await waitFor(() => {
        expect(screen.getByText("Correct")).toBeTruthy();
      });
      // The answer moves focus to Continue (on the next frame), and Enter advances.
      await waitFor(() => {
        expect(document.activeElement).toBe(screen.getByRole("button", { name: "Continue" }));
      });
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByText("Exercise 2 of 2")).toBeTruthy();
      });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "water" }));

      // Arrow down to tree, then Enter submits the focused option (wrong).
      await user.keyboard("{ArrowDown}");
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "tree" }));
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(screen.getByText("Not quite. Correct answer: water")).toBeTruthy();
      });
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getByRole("heading", { name: "Session complete" })).toBeTruthy();
      });
      expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Session complete" }));
      expect(screen.getByText(/1 of 2 correct/)).toBeTruthy();
      // The miss link is the first thing Tab reaches, then Practice again:
      // both work from the keyboard.
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("link", { name: /^水/ }));
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Practice again" }));
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(startCalls()).toHaveLength(2);
      });
    });

    it("number keys choose by position, and out-of-range keys do nothing", async () => {
      const user = userEvent.setup();
      renderPractice();
      startSession();
      await waitFor(() => {
        expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
      });

      await user.keyboard("9");
      expect(postCalls("/answers")).toHaveLength(0);

      await user.keyboard("2");
      await waitFor(() => {
        expect(screen.getByText("Not quite. Correct answer: learn")).toBeTruthy();
      });
      expect(postCalls("/answers")[0]?.body).toEqual({ exerciseId: "ex-1", optionId: "o-tree" });
    });

    it("a held Enter does not skip the feedback of the answer it submitted", async () => {
      const user = userEvent.setup();
      renderPractice();
      startSession();
      await waitFor(() => {
        expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
      });

      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(screen.getByText("Correct")).toBeTruthy();
      });
      // The Enter that submitted the answer must not also press Continue.
      expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
      expect(screen.queryByText("Exercise 2 of 2")).toBeNull();
    });

    it("each option is named and carries its shortcut", async () => {
      renderPractice();
      startSession();
      await waitFor(() => {
        expect(screen.getByText("Exercise 1 of 2")).toBeTruthy();
      });
      expect(screen.getByRole("button", { name: "learn" }).getAttribute("aria-keyshortcuts")).toBe("1");
      expect(screen.getByRole("button", { name: "tree" }).getAttribute("aria-keyshortcuts")).toBe("2");
      expect(screen.getByRole("progressbar", { name: "Practice Session progress" }).getAttribute("aria-valuenow")).toBe("0");
    });
  });
});
