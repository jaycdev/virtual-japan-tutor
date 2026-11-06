import type {
  ApiClient,
  PracticeExercise,
  PracticeResults,
  PracticeSession,
} from "@vjt/api-client";
import { useCallback, useMemo, useRef, useState } from "react";
import { errorMessage, errorCode, exerciseInstruction, failureText, httpFailureText } from "./errors.ts";
import { useInterfaceLanguage } from "./i18n/context.ts";
import type { InterfaceLanguage } from "./i18n/language.ts";

/**
 * State and actions behind the Practice Session screen (issue #9), shared by
 * web and mobile. The server holds the session; every answer is posted
 * immediately (it lands in the Practice Record) and the session is refetched
 * so the server stays the source of truth. The answer result carries the
 * chosen and revealed options, which are kept locally too; the session view
 * also reveals them per exercise, so a reloaded Learner sees the same
 * feedback — the view never sends the correct answer before the Learner has
 * answered.
 *
 * Like the other hooks this never rejects: failures land in `error` and the
 * session stays usable. An answer request is one at a time (`pending`); a
 * session that has expired mid-answer (404) is unrecoverable and returns the
 * screen to the Start form.
 */


/** Feedback for one answered exercise. Ids are empty only for answers the view cannot attribute to an option. */
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
  /** Exercises in the session so far. The server builds them up front, so this equals the session size. */
  generated: number;
  /** The session's target size. */
  target: number;
  /** True while an answer request is in flight: the option buttons are locked. */
  pending: boolean;
  error: string | null;
  /**
   * Asks the server for a session. `seed` makes the session deterministic for
   * the Learner's current Focus Set (the Story deep link starts one seeded
   * from the Story id); omit it for a server-chosen seed.
   */
  start(seed?: number): Promise<void>;
  answer(exerciseId: string, optionId: string): Promise<void>;
  /**
   * Re-fetches the session (used when an answer landed but the automatic
   * refresh after it failed). Resolves true when the session view is back in
   * step, so the screen can tell a retry that worked from one that didn't.
   */
  refresh(): Promise<boolean>;
}

function message(lang: InterfaceLanguage, error: { message?: string } | undefined, status: number): string {
  return errorMessage(lang, errorCode(error), error?.message ?? httpFailureText(lang, status));
}

export function usePractice(client: ApiClient): PracticeView {
  const { language } = useInterfaceLanguage();
  const [session, setSession] = useState<PracticeSession | null>(null);
  // Chosen and revealed options per exercise, kept locally until the server's
  // session view carries the result.
  const [answers, setAnswers] = useState<Map<string, AnswerFeedback>>(() => new Map());
  const [state, setState] = useState<PracticeView["state"]>("idle");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ref, not state: answer() must see the in-flight flag synchronously,
  // before React re-renders. It stops a double-click posting the same answer
  // twice (the second POST would 409 already_answered).
  const inFlight = useRef(false);

  const start = useCallback(async (seed?: number) => {
    setState("starting");
    setError(null);
    try {
      const { data, error: err, response } = await client.POST("/practice/sessions", {
        body: seed === undefined ? {} : { seed },
      });
      if (!data) {
        setError(message(language, err, response.status));
        setState("error");
        return;
      }
      setAnswers(new Map());
      setSession(data);
      setState(data.state === "complete" ? "done" : "active");
    } catch {
      setError(failureText(language));
      setState("error");
    }
  }, [client, language]);

  const refetch = useCallback(async (): Promise<boolean> => {
    if (!session) return false;
    try {
      const refreshed = await client.GET("/practice/sessions/{sessionId}", {
        params: { path: { sessionId: session.id } },
      });
      if (refreshed.data) {
        setSession(refreshed.data);
        setState(refreshed.data.state === "complete" ? "done" : "active");
        setError(null);
        return true;
      }
      setError(message(language, refreshed.error, refreshed.response.status));
      if (refreshed.response.status === 404) {
        setSession(null);
        setState("error");
      }
      return false;
    } catch {
      setError(failureText(language));
      return false;
    }
  }, [client, session, language]);

  const answer = useCallback(
    async (exerciseId: string, optionId: string) => {
      if (!session || inFlight.current) return;
      inFlight.current = true;
      setPending(true);
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
          setError(message(language, err, response.status));
          if (response.status === 404) {
            // The session is gone (expired or foreign): nothing to resume.
            setSession(null);
            setState("error");
          }
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
        await refetch();
      } catch {
        setError(failureText(language));
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [client, language, refetch, session],
  );

  const exercises = useMemo<ExerciseView[]>(() => {
    if (!session) return [];
    return session.exercises.map((ex) => {
      // Prefer the locally recorded answer (it is the freshest); otherwise
      // fall back to what the session view reveals for answered exercises —
      // that is all a reloaded Learner has.
      const local = answers.get(ex.id);
      const feedback: AnswerFeedback | null = local
        ? local
        : ex.answered
          ? {
              chosenOptionId: ex.chosenOptionId ?? "",
              correctOptionId: ex.correctOptionId ?? "",
              correct: ex.correct === true,
            }
          : null;
      return {
        id: ex.id,
        kind: ex.kind,
        // English keeps the server's own sentence; Japanese shows the
        // translated instruction for the exercise's kind (issue #125).
        instruction: exerciseInstruction(language, ex.kind, ex.instruction ?? ""),
        prompt: ex.prompt,
        options: ex.options ?? [],
        answered: ex.answered,
        feedback,
      };
    });
  }, [session, answers, language]);

  const current = useMemo(() => exercises.find((ex) => !ex.answered) ?? null, [exercises]);

  return {
    state,
    session,
    exercises,
    current,
    results: session?.results ?? null,
    generated: session?.exercises.length ?? 0,
    target: session?.targetSize ?? session?.exercises.length ?? 0,
    pending,
    error,
    start,
    answer,
    refresh: refetch,
  };
}
