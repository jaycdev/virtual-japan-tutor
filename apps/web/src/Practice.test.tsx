import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createApiClient } from "@vjt/api-client";
import { afterEach, describe, expect, it } from "vitest";
import { Practice } from "./Practice.tsx";

afterEach(cleanup);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * A stateful fake of the Practice API (issue #9). `requests` records every
 * call's method, path and body so the test can assert the answer loop.
 */
function fakeApi(opts: { empty?: boolean; slowAnswerMs?: number } = {}) {
  interface Exercise {
    id: string;
    kind: string;
    itemKind: string;
    itemRef: string;
    prompt: string;
    instruction: string;
    options: { id: string; text: string }[];
    correctOptionId: string;
    answered: boolean;
    chosenOptionId?: string;
    correct?: boolean;
  }
  const exercises: Exercise[] = [
    {
      id: "e1",
      kind: "recognition",
      itemKind: "vocabulary",
      itemRef: "900001",
      prompt: "学生",
      instruction: "What does this mean?",
      options: [
        { id: "a", text: "student" },
        { id: "b", text: "teacher" },
      ],
      correctOptionId: "a",
      answered: false,
    },
    {
      id: "e2",
      kind: "grammar_cloze",
      itemKind: "grammar",
      itemRef: "900002",
      prompt: "水を飲む＿＿＿。",
      instruction: "Which pattern completes the sentence?",
      options: [
        { id: "a", text: "ました" },
        { id: "b", text: "ください" },
      ],
      correctOptionId: "a",
      answered: false,
    },
  ];

  const requests: { method: string; path: string; body: unknown }[] = [];
  const sessionView = () => {
    const done = exercises.every((ex) => ex.answered);
    return {
      id: "ps-1",
      state: done ? "complete" : "in_progress",
      targetSize: exercises.length,
      skipped: 0,
      exercises: exercises.map((ex) => ({
        id: ex.id,
        kind: ex.kind,
        itemKind: ex.itemKind,
        itemRef: ex.itemRef,
        prompt: ex.prompt,
        instruction: ex.instruction,
        options: ex.options,
        answered: ex.answered,
        // The server reveals both sides only once the Learner has answered.
        ...(ex.answered
          ? {
              correct: ex.correct === true,
              chosenOptionId: ex.chosenOptionId ?? "",
              correctOptionId: ex.correctOptionId,
            }
          : {}),
      })),
      ...(done
        ? {
            results: {
              total: exercises.length,
              correct: exercises.filter((ex) => ex.correct).length,
              items: exercises.map((ex) => ({
                itemKind: ex.itemKind,
                itemRef: ex.itemRef,
                correct: ex.correct === true,
              })),
            },
          }
        : {}),
    };
  };
  let starts = 0;

  const client = createApiClient({
    baseUrl: "http://api.test",
    fetch: async (req) => {
      const url = new URL(req.url);
      const text = await req.text();
      const body = text ? JSON.parse(text) : {};
      requests.push({ method: req.method, path: url.pathname, body });
      const key = `${req.method} ${url.pathname}`;

      if (key === "POST /practice/sessions") {
        starts += 1;
        if (opts.empty) {
          return json(409, { code: "practice_no_items", message: "The Focus Set is empty; there is nothing to practise yet." });
        }
        for (const ex of exercises) {
          ex.answered = false;
          ex.chosenOptionId = undefined;
          ex.correct = undefined;
        }
        return json(201, sessionView());
      }
      if (key === "GET /practice/sessions/ps-1") return json(200, sessionView());
      if (key === "POST /practice/sessions/ps-1/answers") {
        const ex = exercises.find((e) => e.id === body.exerciseId);
        if (!ex) return json(404, { code: "not_found", message: "no such exercise" });
        if (ex.answered) return json(409, { code: "already_answered", message: "that exercise is already answered" });
        if (opts.slowAnswerMs) await new Promise((r) => setTimeout(r, opts.slowAnswerMs));
        ex.answered = true;
        ex.chosenOptionId = String(body.optionId);
        ex.correct = body.optionId === ex.correctOptionId;
        const done = exercises.every((e) => e.answered);
        return json(200, {
          correct: ex.correct,
          correctOptionId: ex.correctOptionId,
          state: done ? "complete" : "in_progress",
        });
      }
      throw new Error(`unexpected ${key}`);
    },
  });
  return { client, requests, startCount: () => starts };
}

describe("Practice page", () => {
  it("walks a session: start, answer with feedback, finish with the results summary", async () => {
    const { client, requests } = fakeApi();
    render(<Practice client={client} />);

    expect(screen.getByRole("heading", { name: "Practice" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));

    expect(await screen.findByText("Exercise 1 of 2")).toBeTruthy();
    expect(screen.getByText("学生")).toBeTruthy();
    expect(screen.getByText("What does this mean?")).toBeTruthy();

    // Answer wrong: feedback lands, the correct option is revealed, the exercise locks.
    fireEvent.click(screen.getByRole("button", { name: "teacher" }));
    expect(await screen.findByText("Not quite")).toBeTruthy();
    const right = screen.getByRole("button", { name: /student/ });
    expect((right as HTMLButtonElement).disabled).toBe(true);
    expect(right.textContent).toContain("correct");
    expect((screen.getByRole("button", { name: /teacher/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /teacher/ }).textContent).toContain("your answer");
    expect(requests).toContainEqual({
      method: "POST",
      path: "/practice/sessions/ps-1/answers",
      body: { exerciseId: "e1", optionId: "b" },
    });

    // The refresh marks it server-side; the exercise stays up until Continue.
    await waitFor(() => expect(requests.filter((r) => r.path.endsWith("/answers"))).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Exercise 2 of 2")).toBeTruthy();
    expect(screen.getByText("水を飲む＿＿＿。")).toBeTruthy();

    // Right answer this time. The last answer's feedback stays on screen —
    // Continue is what moves to the results summary.
    fireEvent.click(screen.getByRole("button", { name: "ました" }));
    expect(await screen.findByText("Correct")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Session complete — 1 of 2 correct.")).toBeTruthy();
    // The review names each exercise by its prompt, not its bare item ref.
    expect(screen.getByText("学生")).toBeTruthy();
    expect(screen.getByText("水を飲む＿＿＿。")).toBeTruthy();
    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("✗")).toBeTruthy();

    // Every answer reached the server exactly once.
    const answers = requests.filter((r) => r.path.endsWith("/answers"));
    expect(answers).toHaveLength(2);
  });

  it("locks the options while an answer is in flight — one POST per exercise", async () => {
    const { client, requests } = fakeApi({ slowAnswerMs: 60 });
    render(<Practice client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
    await screen.findByText("Exercise 1 of 2");

    fireEvent.click(screen.getByRole("button", { name: "student" }));
    // The POST is still open: every option is locked, and further clicks do nothing.
    const other = screen.getByRole("button", { name: "teacher" });
    expect((other as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(other);
    fireEvent.click(screen.getByRole("button", { name: "student" }));

    expect(await screen.findByText("Correct")).toBeTruthy();
    expect(requests.filter((r) => r.path.endsWith("/answers"))).toHaveLength(1);
    // And the exercise stays locked once settled, until Continue.
    expect((other as HTMLButtonElement).disabled).toBe(true);
  });

  it("Practice again starts a fresh session", async () => {
    const { client, startCount } = fakeApi();
    render(<Practice client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
    await screen.findByText("Exercise 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "student" }));
    await screen.findByText("Correct");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("水を飲む＿＿＿。");
    fireEvent.click(screen.getByRole("button", { name: "ください" }));
    await screen.findByText("Not quite");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Session complete — 1 of 2 correct.");

    fireEvent.click(screen.getByRole("button", { name: "Practice again" }));
    await waitFor(() => expect(startCount()).toBe(2));
    expect(await screen.findByText("Exercise 1 of 2")).toBeTruthy();
  });

  it("an empty Focus Set reports why nothing started", async () => {
    const { client } = fakeApi({ empty: true });
    render(<Practice client={client} />);

    fireEvent.click(screen.getByRole("button", { name: "Start a practice session" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Focus Set is empty");
    // Still able to try again.
    expect(screen.getByRole("button", { name: "Start a practice session" })).toBeTruthy();
  });
});
