import type { PracticeSession } from "@vjt/api-client";
import { createApiClient } from "@vjt/api-client";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePractice } from "./usePractice.ts";

function fakeClient() {
  const fetchImpl = vi.fn();
  const client = createApiClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchImpl });
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  return { client, fetchImpl, json };
}

function session(overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    id: "ps-1",
    state: "in_progress",
    targetSize: 2,
    skipped: 0,
    exercises: [
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
        answered: false,
      },
    ],
    ...overrides,
  };
}

describe("usePractice", () => {
  it("starts a session and exposes the generated exercises", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementation(async () => json(201, session()));
    const { result } = renderHook(() => usePractice(client));

    await act(async () => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.state).toBe("active"));
    expect(result.current.session?.id).toBe("ps-1");
    expect(result.current.generated).toBe(2);
    expect(result.current.target).toBe(2);
    expect(result.current.current?.id).toBe("e1");
    expect(result.current.current?.instruction).toBe("What does this mean?");
    expect(result.current.error).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports starting while the create request is in flight", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return json(201, session());
    });
    const { result } = renderHook(() => usePractice(client));

    act(() => {
      void result.current.start();
    });
    expect(result.current.state).toBe("starting");

    await waitFor(() => expect(result.current.state).toBe("active"));
  });

  it("answering marks the choice, reveals the correct option, and refetches", async () => {
    const { client, fetchImpl, json } = fakeClient();
    const afterFirst = session({
      exercises: session().exercises.map((ex, i) =>
        i === 0 ? { ...ex, answered: true, correct: false } : ex,
      ),
    });
    fetchImpl
      .mockImplementationOnce(async () => json(201, session()))
      .mockImplementationOnce(async () =>
        json(200, { exerciseId: "e1", correct: false, correctOptionId: "a", state: "in_progress" }),
      )
      .mockImplementationOnce(async () => json(200, afterFirst));

    const { result } = renderHook(() => usePractice(client));
    await act(async () => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("active"));

    await act(async () => {
      await result.current.answer("e1", "b");
    });

    const first = result.current.exercises[0];
    expect(first?.answered).toBe(true);
    expect(first?.feedback).toEqual({
      chosenOptionId: "b",
      correctOptionId: "a",
      correct: false,
    });
    expect(result.current.current?.id).toBe("e2");
    expect(result.current.state).toBe("active");
    expect(result.current.error).toBeNull();
    // create + answer + refresh
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("a complete session reports done with results", async () => {
    const { client, fetchImpl, json } = fakeClient();
    const complete = session({
      state: "complete",
      results: {
        total: 2,
        correct: 1,
        items: [
          { itemKind: "vocabulary", itemRef: "900001", correct: true },
          { itemKind: "grammar", itemRef: "900002", correct: false },
        ],
      },
      exercises: session().exercises.map((ex, i) => ({
        ...ex,
        answered: true,
        correct: i === 0,
      })),
    });
    fetchImpl.mockImplementation(async () => json(201, complete));

    const { result } = renderHook(() => usePractice(client));
    await act(async () => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.state).toBe("done"));
    expect(result.current.current).toBeNull();
    expect(result.current.results?.correct).toBe(1);
    expect(result.current.results?.total).toBe(2);
    expect(result.current.results?.items).toHaveLength(2);
    // Answers recorded before this view have feedback but no option ids to highlight.
    expect(result.current.exercises[0]?.feedback).toEqual({
      chosenOptionId: "",
      correctOptionId: "",
      correct: true,
    });
  });

  it("an empty Focus Set is surfaced as an error with a retry path", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl.mockImplementation(async () =>
      json(409, { code: "practice_no_items", message: "The Focus Set is empty; there is nothing to practise yet." }),
    );
    const { result } = renderHook(() => usePractice(client));

    await act(async () => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error).toContain("Focus Set is empty");
  });

  it("network failure on start reports a retryable error", async () => {
    const { client, fetchImpl } = fakeClient();
    fetchImpl.mockImplementation(() => Promise.reject(new TypeError("network down")));
    const { result } = renderHook(() => usePractice(client));

    await act(async () => {
      void result.current.start();
    });

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error).toBe("Cannot reach the server");
  });

  it("an answer failure keeps the session active and shows the error", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(201, session()))
      .mockImplementationOnce(async () =>
        json(409, { code: "already_answered", message: "that exercise is already answered" }),
      );

    const { result } = renderHook(() => usePractice(client));
    await act(async () => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("active"));

    await act(async () => {
      await result.current.answer("e1", "a");
    });

    expect(result.current.state).toBe("active");
    expect(result.current.error).toContain("already answered");
    // The exercise stays open because the answer never landed, and no refresh ran.
    expect(result.current.current?.id).toBe("e1");
    expect(result.current.exercises[0]?.feedback).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("a failed refresh after a recorded answer keeps the local feedback", async () => {
    const { client, fetchImpl, json } = fakeClient();
    fetchImpl
      .mockImplementationOnce(async () => json(201, session()))
      .mockImplementationOnce(async () =>
        json(200, { exerciseId: "e1", correct: true, correctOptionId: "a", state: "in_progress" }),
      )
      .mockImplementationOnce(() => Promise.reject(new TypeError("network down")));

    const { result } = renderHook(() => usePractice(client));
    await act(async () => {
      void result.current.start();
    });
    await waitFor(() => expect(result.current.state).toBe("active"));
    await act(async () => {
      await result.current.answer("e1", "a");
    });

    expect(result.current.exercises[0]?.feedback).toEqual({
      chosenOptionId: "a",
      correctOptionId: "a",
      correct: true,
    });
    expect(result.current.error).toBe("Cannot reach the server");
    expect(result.current.state).toBe("active");
  });

  it("ignores answers before a session exists", async () => {
    const { client, fetchImpl } = fakeClient();
    const { result } = renderHook(() => usePractice(client));

    await act(async () => {
      await result.current.answer("e1", "a");
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.state).toBe("idle");
  });
});
