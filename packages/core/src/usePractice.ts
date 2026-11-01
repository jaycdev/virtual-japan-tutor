import type {
  ApiClient,
  PracticeExercise,
  PracticeResults,
  PracticeSession,
} from "@vjt/api-client";
import { useCallback, useMemo, useState } from "react";

/**
 * State and actions behind the Practice Session screen (issue #9), shared by
 * web and mobile. The server holds the session; every answer is posted
 * immediately (it lands in the Practice Record) and the session is refetched
 * so the server stays the source of truth. The chosen option and the revealed
 * correct option are kept locally, because the session view never sends the
 * correct answer before the Learner has answered.
 *
 * Like the other hooks this never rejects: failures land in `error` and the
 * session stays usable.
 */

const UNREACHABLE = "Cannot reach the server";
const FAILED = "Request failed";

/** Feedback for one answered exercise. Ids are empty when the answer was recorded in an earlier view. */
export interface AnswerFeedback {
  chosenOptionId: string;
  correctOptionId: string;
  correct: boolean;
}

/** One exercise as the screen sees it. */
export interface ExerciseView {
  id: string;
  kind: PracticeExercise["kind"];
  /** "What does this mean?" / "Which pattern completes the sentence?" */
  instruction: string;
  prompt: string;
  options: NonNullable<PracticeExercise["options"]>;
  answered: boolean;
  feedback: AnswerFeedback | null;
}

export interface PracticeView {
  state: "idle" | "starting" | "active" | "done" | "error";
  /** The raw session view, once started: id, skipped count, per-exercise truth. */
  session: PracticeSession | null;
  exercises: ExerciseView[];
  /** The first unanswered exercise, or null when the session is complete. */
  current: ExerciseView | null;
  /** Present once the session is complete. */
  results: PracticeResults | null;
  /** Exercises generated so far; the total grows while the server streams them. */
  generated: number;
  /** The session's target size. */
  target: number;
  error: string | null;
  start(): Promise<void>;
  answer(exerciseId: string, optionId: string): Promise<void>;
}

function message(error: { message?: string } | undefined, status: number): string {
  return error?.message ?? `${FAILED} (${status})`;
}

export function usePractice(client: ApiClient): PracticeView {
  const [session, setSession] = useState<PracticeSession | null>(null);
  // Chosen and revealed options per exercise, kept locally until the server's
  // session view carries the result.
  const [answers, setAnswers] = useState<Map<string, AnswerFeedback>>(() => new Map());
  const [state, setState] = useState<PracticeView["state"]>("idle");
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    setState("starting");
    setError(null);
    try {
      const { data, error: err, response } = await client.POST("/practice/sessions", { body: {} });
      if (!data) {
        setError(message(err, response.status));
        setState("error");
        return;
      }
      setAnswers(new Map());
      setSession(data);
      setState(data.state === "complete" ? "done" : "active");
    } catch {
      setError(UNREACHABLE);
      setState("error");
    }
  }, [client]);

  const answer = useCallback(
    async (exerciseId: string, optionId: string) => {
      if (!session) return;
      setError(null);
      try {
        const { data, error: err, response } = await client.POST(
          "/practice/sessions/{sessionId}/answers",
          {
            params: { path: { sessionId: session.id } },
            body: { exerciseId, optionId },
          },
        );
        if (!data) {
          setError(message(err, response.status));
          return;
        }
        // Mark it before refetching, so a failing refresh still shows feedback.
        setAnswers((prev) =>
          new Map(prev).set(exerciseId, {
            chosenOptionId: optionId,
            correctOptionId: data.correctOptionId,
            correct: data.correct,
          }),
        );
        const refreshed = await client.GET("/practice/sessions/{sessionId}", {
          params: { path: { sessionId: session.id } },
        });
        if (refreshed.data) {
          setSession(refreshed.data);
          setState(refreshed.data.state === "complete" ? "done" : "active");
        } else {
          setError(message(refreshed.error, refreshed.response.status));
        }
      } catch {
        setError(UNREACHABLE);
      }
    },
    [client, session],
  );

  const exercises = useMemo<ExerciseView[]>(() => {
    if (!session) return [];
    return session.exercises.map((ex) => {
      const local = answers.get(ex.id);
      const feedback: AnswerFeedback | null = local
        ? local
        : ex.answered
          ? { chosenOptionId: "", correctOptionId: "", correct: ex.correct === true }
          : null;
      return {
        id: ex.id,
        kind: ex.kind,
        instruction: ex.instruction ?? "",
        prompt: ex.prompt,
        options: ex.options ?? [],
        answered: ex.answered,
        feedback,
      };
    });
  }, [session, answers]);

  const current = useMemo(() => exercises.find((ex) => !ex.answered) ?? null, [exercises]);

  return {
    state,
    session,
    exercises,
    current,
    results: session?.results ?? null,
    generated: session?.exercises.length ?? 0,
    target: session?.targetSize ?? session?.exercises.length ?? 0,
    error,
    start,
    answer,
  };
}
