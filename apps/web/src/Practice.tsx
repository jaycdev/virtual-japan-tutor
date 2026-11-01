import type { createApiClient } from "@vjt/api-client";
import { usePractice, type ExerciseView, type PracticeView } from "@vjt/core";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";

type Api = ReturnType<typeof createApiClient>;

/**
 * Practice Sessions (issue #9): one session drawn from the Focus Set, one
 * exercise at a time; every answer is recorded server-side into the Practice
 * Record, so Mastery and the Focus Set move as the Learner answers. The
 * results summary doubles as the review of what was missed.
 */
export function Practice({ client }: { client: Api }) {
  const practice = usePractice(client);
  // The exercise on screen. It stays up after answering so the Learner sees
  // what was right; Continue moves to the next unanswered one.
  const [shownId, setShownId] = useState<string | null>(null);

  let body: ReactNode = null;
  switch (practice.state) {
    case "idle":
    case "error":
      body = <StartPractice practice={practice} />;
      break;
    case "starting":
      body = <p className="muted">Building your session from the Focus Set…</p>;
      break;
    case "done":
      body = <PracticeResults practice={practice} />;
      break;
    case "active": {
      const shown = practice.exercises.find((ex) => ex.id === shownId) ?? practice.current;
      body = shown ? (
        <ActivePractice
          practice={practice}
          current={shown}
          onContinue={() => setShownId(null)}
          onAnswer={(exerciseId, optionId) => {
            setShownId(exerciseId);
            void practice.answer(exerciseId, optionId);
          }}
        />
      ) : (
        <p className="muted">The next exercise is on its way…</p>
      );
      break;
    }
  }
  return (
    <>
      <h2>Practice</h2>
      {practice.error && (
        <p className="error" role="alert">
          {practice.error}
        </p>
      )}
      {body}
    </>
  );
}

function StartPractice({ practice }: { practice: PracticeView }) {
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void practice.start();
      }}
    >
      <p>
        A session is about twenty exercises drawn from your Focus Set —
        recognition and grammar cloze — and every answer feeds your mastery
        record.
      </p>
      <button type="submit">Start a practice session</button>
    </form>
  );
}

function ActivePractice({
  practice,
  current,
  onContinue,
  onAnswer,
}: {
  practice: PracticeView;
  current: ExerciseView;
  onContinue: () => void;
  onAnswer: (exerciseId: string, optionId: string) => void;
}) {
  const answeredCount = practice.exercises.filter((ex) => ex.answered).length;
  const skipped = practice.session?.skipped ?? 0;
  const feedback = current.feedback;
  const settled = feedback !== null;
  return (
    <>
      <p className="muted">
        Exercise {Math.min(answeredCount + 1, practice.target)} of {practice.target}
        {skipped > 0 && ` (${skipped} Focus Set item${skipped === 1 ? "" : "s"} without content, skipped)`}
      </p>
      <p>
        {current.instruction} <strong>{current.prompt}</strong>
      </p>
      {feedback && (
        <p className={feedback.correct ? "saved" : "error"} role="status">
          {feedback.correct ? "Correct" : "Not quite"}
        </p>
      )}
      <ul className="option-list">
        {current.options.map((opt) => {
          const chosen = feedback !== null && feedback.chosenOptionId === opt.id;
          const right = feedback !== null && feedback.correctOptionId === opt.id;
          const mark = !feedback ? "" : right ? " ← correct" : chosen ? " ← your answer" : "";
          return (
            <li key={opt.id}>
              <button
                type="button"
                disabled={settled}
                className={settled ? (right ? "option correct" : chosen ? "option chosen-wrong" : "option") : "option"}
                onClick={() => onAnswer(current.id, opt.id)}
              >
                {opt.text}
                {mark}
              </button>
            </li>
          );
        })}
      </ul>
      {settled && (
        <button type="button" onClick={onContinue}>
          Continue
        </button>
      )}
    </>
  );
}

function PracticeResults({ practice }: { practice: PracticeView }) {
  const [retryKey, setRetryKey] = useState(0);
  return (
    <>
      <p className="saved" role="status">
        Session complete — {practice.results?.correct ?? 0} of {practice.results?.total ?? 0} correct.
      </p>
      <table>
        <caption>Every item you practised</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Kind</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {(practice.results?.items ?? []).map((item, i) => (
            <tr key={`${item.itemKind}:${item.itemRef}:${i}`}>
              <td>{item.itemRef}</td>
              <td>{item.itemKind}</td>
              <td>{item.correct ? "✓" : "✗"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        key={retryKey}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setRetryKey((k) => k + 1);
          void practice.start();
        }}
      >
        <button type="submit">Practice again</button>
      </form>
    </>
  );
}
