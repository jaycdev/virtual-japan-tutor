// The Practice Session screen (ui-plan 4.3, issue #78). One Exercise at a time on
// a centred card (max about 560 px), the prompt in the serif at a large size, a
// thin progress bar for the session, and calm inline feedback after each answer.
// The logic is @vjt/core's usePractice; this file only shows it for a desktop
// browser, with the keyboard as a first-class way through a whole session:
//
//   1-9       choose that option (it is submitted at once, like a click)
//   Enter     submit the focused option, or Continue once an answer has landed
//   Arrows    move between options (Home and End jump to the ends)
//
// Each new Exercise puts focus on its first option, and an answer that lands
// moves focus to Continue, so the next key always does something useful. The
// feedback line is a polite live region that is always in the DOM, so a screen
// reader announces the verdict as it appears.
import type { ApiClient } from "@vjt/api-client";
import { displayPrompt, usePractice, type ExerciseView, type PracticeView } from "@vjt/core";
import { ChevronRight, CircleCheck, CircleX } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, SkeletonLines } from "@/components/states";
import { cn } from "@/lib/utils";

export function Practice({ client, seed }: { client: ApiClient; seed?: number }) {
  const practice = usePractice(client);
  const { start, answer, refresh } = practice;
  // The exercise on screen. It stays up after answering so the Learner sees
  // what was right, even when the last answer has finished the session;
  // Continue is what moves on to the results.
  const [shownId, setShownId] = useState<string | null>(null);
  // The answer the Learner last tried, so Retry can re-post it when the POST
  // failed rather than the follow-up refresh.
  const lastAttempt = useRef<{ exerciseId: string; optionId: string } | null>(null);
  // Deep link (/practice?storyId=): the session starts on arrival, keyed on the
  // seed so a different Story's link restarts the session too. The ref swallows
  // Strict Mode's double effect.
  const startedSeed = useRef<number | undefined>(undefined);
  // The seed the current session started with, so "Practice again" runs the
  // same session the link asked for.
  const sessionSeed = useRef<number | undefined>(undefined);

  const startSession = useCallback(
    (startSeed?: number) => {
      sessionSeed.current = startSeed;
      lastAttempt.current = null;
      setShownId(null);
      void start(startSeed);
    },
    [start],
  );

  useEffect(() => {
    if (seed === undefined || startedSeed.current === seed) return;
    startedSeed.current = seed;
    startSession(seed);
  }, [seed, startSession]);

  // Retry inside the active card: if the shown exercise already has feedback the
  // answer landed and the session refresh is what failed, so re-GET the session;
  // otherwise the answer POST itself failed and the last choice is re-posted.
  const retryActive = (exerciseId: string) => {
    const answered = practice.exercises.find((ex) => ex.id === exerciseId)?.feedback;
    const attempt = lastAttempt.current;
    if (answered || !attempt) {
      void refresh();
    } else {
      void answer(attempt.exerciseId, attempt.optionId);
    }
  };

  // Continue while the session is out of step (the refresh after the answer
  // failed): retry the GET first and advance only once the server agrees.
  const onContinue = () => {
    if (practice.error) {
      void refresh().then((ok) => {
        if (ok) setShownId(null);
      });
      return;
    }
    setShownId(null);
  };

  const answerShown = (exerciseId: string, optionId: string) => {
    setShownId(exerciseId);
    lastAttempt.current = { exerciseId, optionId };
    void answer(exerciseId, optionId);
  };

  const practiceAgain = () => startSession(sessionSeed.current);

  const shown = shownId ? practice.exercises.find((ex) => ex.id === shownId) : undefined;
  // After the session completes, the card stays up only while the last answer's
  // feedback is on screen; otherwise the results (or the empty state) show.
  const card = practice.state === "done" ? (shown?.feedback ? shown : null) : (shown ?? practice.current);

  let body: ReactNode;
  if (practice.state === "idle" || practice.state === "error") {
    body = <StartPractice error={practice.error} onStart={() => startSession(seed)} />;
  } else if (practice.state === "starting") {
    body = <StartingCard />;
  } else if (card) {
    body = (
      <ActivePractice
        practice={practice}
        current={card}
        onContinue={onContinue}
        onRetry={() => retryActive(card.id)}
        onAnswer={answerShown}
      />
    );
  } else if (practice.exercises.length === 0) {
    // A "complete" session of nothing would otherwise read as a 0-of-0 score the
    // Learner never played.
    body = <NothingToPractise />;
  } else if (practice.state === "done") {
    body = <PracticeResults practice={practice} onAgain={practiceAgain} />;
  } else {
    body = <p className="text-body text-muted-foreground">The next exercise is on its way…</p>;
  }

  return (
    <section className="mx-auto flex w-full max-w-[35rem] flex-col gap-6">
      <h1 className="text-title font-semibold text-foreground">Practice</h1>
      {/* Always mounted: only its text changes, so a screen reader announces
          the starting status without a new live region appearing. No role=status
          here: the app shell's route announcer is one, and the two must not be
          confused (aria-live alone is enough for a persistent region). */}
      <p data-testid="practice-status" aria-live="polite" className="text-body text-muted-foreground">
        {practice.state === "starting" ? "Building your session from the Focus Set…" : ""}
      </p>
      {body}
    </section>
  );
}

/**
 * A prompt with its cloze blank kept whole. displayPrompt glues the blank to
 * its punctuation; here each run of blanks is also a nowrap span, because a
 * browser may otherwise break a long blank between two underscores at narrow
 * widths (checked at 390 px).
 */
function PromptText({ text }: { text: string }) {
  return (
    <>
      {displayPrompt(text)
        .split(/([＿_]+)/u)
        .map((part, index) =>
          index % 2 === 1 ? (
            <span key={index} className="whitespace-nowrap">
              {part}
            </span>
          ) : (
            part
          ),
        )}
    </>
  );
}

/** The one card shape shared by the start, exercise, empty and results states (ui-plan 4.3). */
function PracticeCard({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-6">{children}</div>;
}

/**
 * Where the Practice key shortcuts must not reach: text entry, and any dialog,
 * sheet or menu (the Radix dialog behind the 390 px nav sheet, for one).
 */
const BLOCKED_KEY_TARGETS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

function StartPractice({ error, onStart }: { error: string | null; onStart: () => void }) {
  return (
    <PracticeCard>
      {error ? <ErrorState message={error} onRetry={onStart} /> : null}
      <p className="text-body text-muted-foreground">
        A session is about twenty exercises drawn from your Focus Set, recognition and grammar cloze. Every answer
        feeds your mastery record.
      </p>
      <div>
        <Button onClick={onStart}>Start a practice session</Button>
      </div>
    </PracticeCard>
  );
}

/**
 * The starting skeleton. Its status line lives in the screen's persistent live
 * region (see Practice), so the text changes in a region that is already in the
 * DOM rather than a new role=status appearing with its text.
 */
function StartingCard() {
  return (
    <PracticeCard>
      <SkeletonLines lines={4} />
    </PracticeCard>
  );
}

/** The Focus Set has no practisable content: one line, one way forward. */
function NothingToPractise() {
  return (
    <PracticeCard>
      <EmptyState
        compact
        message="Nothing in your Focus Set to practise yet"
        action={
          <Button asChild variant="outline">
            <Link to="/settings/lists">Open your Item Lists</Link>
          </Button>
        }
      />
    </PracticeCard>
  );
}

function ActivePractice({
  practice,
  current,
  onContinue,
  onRetry,
  onAnswer,
}: {
  practice: PracticeView;
  current: ExerciseView;
  onContinue: () => void;
  onRetry: () => void;
  onAnswer: (exerciseId: string, optionId: string) => void;
}) {
  const answeredCount = practice.exercises.filter((ex) => ex.answered).length;
  const skipped = practice.session?.skipped ?? 0;
  const feedback = current.feedback;
  // Named from the exercise on screen, not the answered count: the card keeps
  // showing an answered exercise while its feedback is up.
  const position = practice.exercises.findIndex((ex) => ex.id === current.id) + 1;
  // Settled once the answer landed; pending covers the request in flight, so a
  // double press cannot post the same answer twice.
  const settled = feedback !== null;
  const locked = settled || practice.pending;
  const percent = practice.target ? Math.round((answeredCount / practice.target) * 100) : 0;
  const progressLabel =
    `Exercise ${Math.max(1, position)} of ${practice.target}` +
    (skipped > 0 ? ` (${skipped} Focus Set item${skipped === 1 ? "" : "s"} without content, skipped)` : "");

  const continueRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const instructionId = useId();
  const promptTextId = useId();

  // Focus follows the session: the first option of each new Exercise, and
  // Continue once an answer lands. Continue moves on the next frame, after the
  // verdict text is in the live region, so a screen reader does not drop the
  // status when focus moves. Keyed on the exercise and the settled flag, so a
  // retry or a refresh does not move focus.
  useEffect(() => {
    if (!settled) {
      optionRefs.current[0]?.focus();
      return;
    }
    const frame = requestAnimationFrame(() => {
      // Only if focus is still where the answer left it. If the Learner has
      // moved on (a link, the nav sheet), the frame must not pull focus back.
      const active = document.activeElement;
      if (active === null || active === document.body || optionRefs.current.includes(active as HTMLButtonElement)) {
        continueRef.current?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [current.id, settled]);

  // Enter and the number keys are the screen's while an exercise is up, but
  // only from places they belong to: the body, an option, or Continue. A key
  // typed in an input, in a dialog or sheet, or on a link or button elsewhere
  // on the page (the sidebar, Log out, an ErrorState Retry) is left alone.
  // Enter submits the focused option, or continues once settled. The handler
  // calls preventDefault, so the keypress cannot also click the button focus has
  // just moved to (which would skip past the feedback).
  useEffect(() => {
    function keyIsOurs(target: EventTarget | null): boolean {
      if (target === document.body) return true;
      if (!(target instanceof Element)) return false;
      if (target.closest(BLOCKED_KEY_TARGETS)) return false;
      return target === continueRef.current || optionRefs.current.includes(target as HTMLButtonElement);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!keyIsOurs(event.target)) return;
      if (settled) {
        if (event.key === "Enter" && !event.repeat && !practice.pending) {
          event.preventDefault();
          onContinue();
        }
        return;
      }
      if (practice.pending) return;
      if (event.key === "Enter") {
        const focused = optionRefs.current.findIndex((el) => el !== null && el === event.target);
        const option = focused >= 0 ? current.options[focused] : undefined;
        if (option) {
          event.preventDefault();
          onAnswer(current.id, option.id);
        }
        return;
      }
      if (/^[1-9]$/.test(event.key)) {
        const option = current.options[Number(event.key) - 1];
        if (option) {
          event.preventDefault();
          onAnswer(current.id, option.id);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settled, practice.pending, current, onAnswer, onContinue]);

  // Arrow keys move focus between options without answering.
  function onGroupKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const count = current.options.length;
    const index = optionRefs.current.findIndex((el) => el !== null && el === document.activeElement);
    if (index < 0 || count === 0) return;
    let next: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (index + 1) % count;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (index - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    optionRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">{progressLabel}</p>
        <div
          role="progressbar"
          aria-label="Practice Session progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={progressLabel}
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <PracticeCard>
        <div className="flex flex-col gap-3">
          <p id={instructionId} className="text-small text-muted-foreground">
            {current.instruction}
          </p>
          <p id={promptTextId} lang="ja" className="font-serif text-display text-foreground">
            <PromptText text={current.prompt} />
          </p>
        </div>
        {/* Named by the instruction and the prompt together, so the group reads
            "What does this mean? 学", not just the instruction. */}
        <div
          role="group"
          aria-labelledby={`${instructionId} ${promptTextId}`}
          onKeyDown={onGroupKeyDown}
          className="flex flex-col gap-2"
        >
          {current.options.map((opt, index) => {
            const chosen = feedback !== null && feedback.chosenOptionId === opt.id;
            const right = feedback !== null && feedback.correctOptionId === opt.id;
            return (
              <OptionButton
                key={opt.id}
                innerRef={(el) => {
                  optionRefs.current[index] = el;
                }}
                index={index}
                label={opt.text}
                state={feedback === null ? "open" : right ? "correct" : chosen ? "wrong" : "dim"}
                locked={locked}
                onChoose={() => {
                  if (!locked) onAnswer(current.id, opt.id);
                }}
              />
            );
          })}
        </div>
        {/* The verdict is a polite live region that is always mounted, so the
            screen reader announces it as the text arrives. The min height keeps
            the card from jumping when feedback appears. */}
        <div role="status" aria-live="polite" className="flex min-h-6 flex-nowrap items-start gap-2">
          {feedback ? (
            <>
              {feedback.correct ? (
                <CircleCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-success" />
              ) : (
                <CircleX aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-destructive" />
              )}
              <span
                className={cn(
                  "min-w-0 text-body font-semibold",
                  feedback.correct ? "text-success" : "text-destructive",
                )}
              >
                {feedbackLine(current, feedback)}
              </span>
            </>
          ) : null}
        </div>
        {practice.error ? <ErrorState message={practice.error} onRetry={onRetry} /> : null}
        {settled ? (
          <div className="flex justify-end">
            <Button ref={continueRef} onClick={onContinue}>
              Continue
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </PracticeCard>
    </div>
  );
}

/**
 * The feedback line. A miss names the right answer outright, so the Learner
 * does not have to find a marker on the option list.
 */
function feedbackLine(current: ExerciseView, feedback: NonNullable<ExerciseView["feedback"]>): string {
  if (feedback.correct) return "Correct";
  const answer = current.options.find((opt) => opt.id === feedback.correctOptionId)?.text;
  return answer ? `Not quite. Correct answer: ${answer}` : "Not quite";
}

function OptionButton({
  innerRef,
  index,
  label,
  state,
  locked,
  onChoose,
}: {
  innerRef: (el: HTMLButtonElement | null) => void;
  index: number;
  label: string;
  state: "open" | "correct" | "wrong" | "dim";
  locked: boolean;
  onChoose: () => void;
}) {
  // aria-current marks the right option for a screen reader once the answer
  // lands, without changing the button's accessible name.
  const border =
    state === "correct"
      ? "border-success text-success"
      : state === "wrong"
        ? "border-destructive text-destructive"
        : "border-border text-foreground";
  return (
    <button
      ref={innerRef}
      type="button"
      aria-keyshortcuts={String(index + 1)}
      aria-current={state === "correct" ? "true" : undefined}
      aria-disabled={locked || undefined}
      onClick={onChoose}
      className={cn(
        "flex min-h-11 w-full items-center gap-3 rounded-lg border bg-background px-4 py-3 text-left text-body outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
        border,
        locked ? "cursor-default" : "hover:bg-accent",
        state === "dim" && "opacity-50",
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border text-caption text-muted-foreground"
      >
        {index + 1}
      </span>
      <span className="flex-1">{label}</span>
      {state === "correct" ? <CircleCheck aria-hidden="true" className="size-5 shrink-0" /> : null}
      {state === "wrong" ? <CircleX aria-hidden="true" className="size-5 shrink-0" /> : null}
    </button>
  );
}

/** itemKind as Learner-facing copy, not the API's raw token. */
function humanKind(kind: string): string {
  const words: Record<string, string> = {
    kanji: "Kanji",
    kana: "Kana",
    grammar: "Grammar point",
    vocabulary: "Word",
    phrase: "Phrase",
  };
  return words[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * Where a session item's detail lives, and the label that says so. THIS IS THE
 * ONE PLACE TO CHANGE when a web Dictionary Entry route exists: return it for
 * vocabulary and kanji here (today a Dictionary Entry opens from the reader's
 * Lookup, so there is no route to link to, and the Item Lists is the closest page).
 *
 * Grammar: /grammar/:grammarId takes the Grammar Catalogue point id as text (PR
 * #86's parsePointId), and the grammar itemRef is that same id, so it links as is.
 */
export function destinationForItem(itemKind: string, itemRef: string): { to: string; label: string } {
  if (itemKind === "grammar") {
    return { to: `/grammar/${encodeURIComponent(itemRef)}`, label: "Open Grammar Point" };
  }
  return { to: "/settings/lists", label: "Open Item Lists" };
}

function PracticeResults({ practice, onAgain }: { practice: PracticeView; onAgain: () => void }) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const exercises = practice.session?.exercises ?? [];
  const items = practice.results?.items ?? [];
  // Misses are indexed by position so each row quotes the exercise's own prompt
  // and the option that was right, rather than a raw cloze token.
  const again = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.correct);
  const totalExercises = exercises.length;

  // Moving the focus here tells a screen reader the session is over, and leaves
  // the keyboard at the start of the results.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <PracticeCard>
      <h2 ref={headingRef} tabIndex={-1} className="text-title font-semibold text-foreground outline-none">
        Session complete
      </h2>
      <p className="text-body text-muted-foreground">
        {practice.results?.correct ?? 0} of {practice.results?.total ?? 0} correct - {totalExercises} exercise
        {totalExercises === 1 ? "" : "s"} from your Focus Set.
      </p>
      {again.length > 0 ? (
        <section className="flex flex-col gap-3" aria-labelledby="practice-needs-look">
          <h3 id="practice-needs-look" className="text-small font-semibold text-muted-foreground">
            Needs another look
          </h3>
          <ul className="flex flex-col gap-3">
            {again.map(({ item, index }) => {
              const exercise = practice.exercises[index];
              const answer = exercise?.options.find((opt) => opt.id === exercise.feedback?.correctOptionId)?.text;
              const destination = destinationForItem(item.itemKind, item.itemRef);
              return (
                <li
                  key={`${item.itemKind}:${item.itemRef}:${index}`}
                  className="flex items-start gap-3 border-b border-border pb-3"
                >
                  <CircleX aria-hidden="true" className="mt-1 size-5 shrink-0 text-destructive" />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    {answer ? <span className="text-small text-foreground">Correct answer: {answer}</span> : null}
                    {/* The link's name is its prompt and where it goes ("…。 Open
                        Grammar Point"), so a screen reader hears the destination. */}
                    <Link
                      to={destination.to}
                      className="group flex min-w-0 flex-col gap-0.5 text-primary underline-offset-4"
                    >
                      <span lang="ja" className="font-serif text-body group-hover:underline">
                        <PromptText text={exercise ? exercise.prompt : item.itemRef} />
                      </span>
                      <span className="text-small group-hover:underline">{destination.label}</span>
                    </Link>
                  </div>
                  <span className="text-caption text-muted-foreground">{humanKind(item.itemKind)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="text-body text-muted-foreground">Nothing to revisit this time.</p>
      )}
      <div>
        <Button onClick={onAgain}>Practice again</Button>
      </div>
    </PracticeCard>
  );
}
