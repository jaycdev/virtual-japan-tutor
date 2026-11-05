import type { ApiClient } from "@vjt/api-client";
import { displayPrompt, usePractice, type ExerciseView, type PracticeView } from "@vjt/core";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewInstance } from "react-native";

import { useJapaneseFont } from "./japaneseFont/index.tsx";
import { Icon } from "./components/ui/icon.tsx";
import { Card as UiCard } from "./components/ui/Card.tsx";
import { EmptyState, InlineError, ProgressBar, Skeleton } from "./state/states.tsx";

/**
 * Practice Sessions (issue #9; rebuilt on the new design for issue #46): one
 * session drawn from the Focus Set, one exercise at a time on a centred card,
 * every answer recorded server-side. The exercise on screen stays up after
 * answering so the Learner sees what was right; Continue moves on.
 *
 * Styling is design-token classes only (plan §3): no palette colours, no
 * inline font sizes. `seed` carries the Story deep link (see practiceSeedForStory).
 */

/** Widest the exercise card grows; past this the margins take over (plan 4.3). */
const CARD_MAX_WIDTH = 560;

// The pure helpers live in @vjt/core (shared with apps/web, #78). Re-exported
// here so the existing imports and tests keep their path.
export { displayPrompt, practiceSeedForStory } from "@vjt/core";

export function Practice({
  client,
  seed,
  onOpenWordLists,
}: {
  client: ApiClient;
  seed?: number;
  /** Empty-state action: take the Learner to their Item Lists. */
  onOpenWordLists?: () => void;
}) {
  const practice = usePractice(client);
  // The exercise on screen. It stays up after answering so the Learner sees
  // what was right — even after the last answer flips the session to done;
  // Continue is what moves on to the results.
  const [shownId, setShownId] = useState<string | null>(null);
  // The answer the Learner last tried, so the InlineError's Retry can re-post
  // it when the answer POST failed (#46 review B3).
  const lastAttempt = useRef<{ exerciseId: string; optionId: string } | null>(null);

  // Deep-linked from a Story footer (#46): no Start tap — the session begins
  // immediately, seeded from the Story so the link is reproducible. Keyed on
  // the seed, not a fired-once flag: arriving with a different Story's seed
  // must start that session too instead of leaving the old one up
  // (#46 review B4). The ref still swallows Strict Mode's double effect.
  const startedSeed = useRef<number | undefined>(undefined);
  // The seed the current session started with, so "Practice again" runs the
  // same session the deep link asked for rather than a server-chosen one.
  const sessionSeed = useRef<number | undefined>(undefined);

  const startSession = useCallback(
    (startSeed?: number) => {
      sessionSeed.current = startSeed;
      lastAttempt.current = null;
      setShownId(null);
      void practice.start(startSeed);
    },
    [practice],
  );

  useEffect(() => {
    if (seed === undefined || startedSeed.current === seed) return;
    startedSeed.current = seed;
    startSession(seed);
  }, [practice, seed, startSession]);

  // Retry inside the active card (B3): if the shown exercise already has
  // feedback the answer landed and it was the session refresh that failed, so
  // re-GET the session; otherwise the answer POST itself failed and the last
  // choice is re-posted.
  const retryActive = (exerciseId: string) => {
    const answered = practice.exercises.find((ex) => ex.id === exerciseId)?.feedback;
    const attempt = lastAttempt.current;
    if (answered || !attempt) {
      void practice.refresh();
    } else {
      void practice.answer(attempt.exerciseId, attempt.optionId);
    }
  };

  // Continue while the session is out of step (the refresh after the answer
  // failed): retry the GET first and advance only once the server agrees, so
  // the Learner never advances onto a half-synced session (#46 review B3).
  const onContinue = () => {
    if (practice.error) {
      void practice.refresh().then((ok) => {
        if (ok) setShownId(null);
      });
      return;
    }
    setShownId(null);
  };

  // Declared alongside retryActive rather than inline: the ref-touching
  // handlers stay out of the render-scope arrow functions the hooks lint
  // (rightly) distrusts.
  const answerShown = (exerciseId: string, optionId: string) => {
    setShownId(exerciseId);
    lastAttempt.current = { exerciseId, optionId };
    void practice.answer(exerciseId, optionId);
  };
  const practiceAgain = () => startSession(sessionSeed.current);

  return (
    <ScrollView
      className="flex-1"
      accessibilityLabel="Practice Session"
      contentContainerStyle={styles.page}
    >
      <View className="w-full gap-4" style={styles.column}>
        {practice.state === "idle" || practice.state === "error" ? (
          <StartPractice practice={practice} onStart={startSession} />
        ) : practice.state === "starting" ? (
          <StartingCard />
        ) : practice.state === "done" ? (
          // The final answer's feedback stays on screen until Continue, so the
          // Learner sees the last exercise's result too.
          (() => {
            const shown = shownId ? practice.exercises.find((ex) => ex.id === shownId) : undefined;
            return shown && shown.feedback ? (
              <ActivePractice
                practice={practice}
                current={shown}
                onContinue={onContinue}
                onRetry={() => retryActive(shown.id)}
                onAnswer={() => undefined}
              />
            ) : practice.exercises.length === 0 ? (
              // A "complete" session of nothing would otherwise read as a
              // 0-of-0 score the Learner never played (#46 review).
              <NothingToPractise onOpenWordLists={onOpenWordLists} />
            ) : (
              <PracticeResults practice={practice} onAgain={practiceAgain} />
            );
          })()
        ) : (
          (() => {
            const shown = practice.exercises.find((ex) => ex.id === shownId) ?? practice.current;
            return shown ? (
              <ActivePractice
                practice={practice}
                current={shown}
                onContinue={onContinue}
                onRetry={() => retryActive(shown.id)}
                onAnswer={answerShown}
              />
            ) : practice.exercises.length === 0 ? (
              // The Focus Set had nothing to build from: not a stuck session,
              // a state with one clear next step (#46 review).
              <NothingToPractise onOpenWordLists={onOpenWordLists} />
            ) : (
              <Text className="text-body text-muted-foreground">The next exercise is on its way…</Text>
            );
          })()
        )}
      </View>
    </ScrollView>
  );
}

/** Card shell shared by the start, exercise and results states (plan 4.3):
 *  the ui Card itself, with the states' shared test handle. */
function Card({ children }: { children: ReactNode }) {
  return <UiCard testID="practice-card">{children}</UiCard>;
}

function StartPractice({ practice, onStart }: { practice: PracticeView; onStart: (seed?: number) => void }) {
  return (
    <Card>
      {practice.error ? (
        <InlineError message={practice.error} onRetry={() => onStart()} />
      ) : null}
      <Text className="text-body text-muted-foreground">
        A session is about twenty exercises drawn from your Focus Set — recognition and grammar
        cloze — and every answer feeds your mastery record.
      </Text>
      <PrimaryAction label="Start a practice session" onPress={() => onStart()} />
    </Card>
  );
}

function StartingCard() {
  return (
    <Card>
      <Text className="text-body text-muted-foreground">Building your session from the Focus Set…</Text>
      <Skeleton lines={4} lineHeight={24} />
    </Card>
  );
}

/** The Focus Set has no practisable content: one line, one way forward. */
function NothingToPractise({ onOpenWordLists }: { onOpenWordLists?: () => void }) {
  return (
    <Card>
      <EmptyState
        message="Nothing in your Focus Set to practise yet"
        actionLabel="Open your Item Lists"
        onAction={onOpenWordLists}
      />
    </Card>
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
  const jp = useJapaneseFont();
  const answeredCount = practice.exercises.filter((ex) => ex.answered).length;
  const skipped = practice.session?.skipped ?? 0;
  const feedback = current.feedback;
  // The label names the exercise on screen, not "one past the answered count":
  // the card keeps showing an answered exercise while its feedback is up, and
  // the count-based label read "Exercise 2 of 2" over Exercise 1's feedback
  // (#46 review B1).
  const position = practice.exercises.findIndex((ex) => ex.id === current.id) + 1;
  // Settled once the answer landed; pending covers the request in flight, so
  // a double-click cannot post the same answer twice.
  const settled = feedback !== null;
  const locked = settled || practice.pending;
  // S5: when an answer lands, focus moves to Continue — a screen-reader user
  // is left at the control that advances without hunting for it. Only the
  // not-settled→settled transition fires, so a page that reloads onto already
  // answered content does not steal focus on load.
  const continueRef = useRef<ViewInstance | null>(null);
  const wasSettled = useRef(false);
  useEffect(() => {
    if (settled && !wasSettled.current) continueRef.current?.focus();
    wasSettled.current = settled;
  }, [settled]);
  return (
    <View className="gap-4">
      <ProgressBar
        value={practice.target ? answeredCount / practice.target : 0}
        label={
          `Exercise ${Math.max(1, position)} of ${practice.target}` +
          (skipped > 0 ? ` (${skipped} Focus Set item${skipped === 1 ? "" : "s"} without content, skipped)` : "")
        }
      />
      <Card>
        <Text className="text-small text-muted-foreground">{current.instruction}</Text>
        <Text className={`text-display text-foreground ${jp.serif}`}>{displayPrompt(current.prompt)}</Text>
        {feedback ? (
          <View
            // The verdict appears on its own: a polite live region announces
            // it without interrupting, on both hosts (S5). The role prop (not
            // accessibilityRole="status", which RCTText rejects on Android).
            accessibilityLiveRegion="polite"
            role="status"
            aria-live="polite"
            className="flex-row flex-wrap items-center gap-2"
          >
            <Icon
              name={feedback.correct ? "circle-check" : "circle-x"}
              size="sm"
              className={feedback.correct ? "text-success" : "text-destructive"}
            />
            <Text className={feedback.correct ? "text-body font-semibold text-success" : "text-body font-semibold text-destructive"}>
              {feedbackLine(current, feedback)}
            </Text>
          </View>
        ) : null}
        <View className="gap-2">
          {current.options.map((opt) => {
            const chosen = feedback !== null && feedback.chosenOptionId === opt.id;
            const right = feedback !== null && feedback.correctOptionId === opt.id;
            return (
              <OptionButton
                key={opt.id}
                label={opt.text}
                state={feedback === null ? "open" : right ? "correct" : chosen ? "wrong" : "dim"}
                disabled={locked}
                onPress={() => onAnswer(current.id, opt.id)}
              />
            );
          })}
        </View>
        {/* A failed answer POST or failed session refresh surfaces in place
            with an explicit Retry (plan §5), not as a silent stuck card
            (#46 review B3). */}
        {practice.error ? <InlineError message={practice.error} onRetry={onRetry} /> : null}
        {settled ? (
          <PrimaryAction label="Continue" icon="chevron-right" onPress={onContinue} innerRef={continueRef} />
        ) : null}
      </Card>
    </View>
  );
}

/**
 * The feedback line. A miss names the right answer outright — a marker on the
 * option list alone was too easy to miss (#46 review S1).
 */
function feedbackLine(current: ExerciseView, feedback: NonNullable<ExerciseView["feedback"]>): string {
  if (feedback.correct) return "Correct";
  const answer = current.options.find((opt) => opt.id === feedback.correctOptionId)?.text;
  return answer ? `Not quite. Correct answer: ${answer}` : "Not quite";
}

function OptionButton({
  label,
  state,
  disabled,
  onPress,
}: {
  label: string;
  state: "open" | "correct" | "wrong" | "dim";
  disabled: boolean;
  onPress: () => void;
}) {
  const border =
    state === "correct" ? "border-success" : state === "wrong" ? "border-destructive" : "border-border";
  // P1: option text sits at the body step (16/24) — title-sized options made
  // the card louder than the prompt it answers.
  const text =
    state === "correct"
      ? "text-body text-success"
      : state === "wrong"
        ? "text-body text-destructive"
        : "text-body text-foreground";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // One row, equal padding top and bottom, content centred (S4): the old
      // flex-wrap let an option's line sit lopsided inside the box.
      className={`min-h-11 flex-row items-center justify-center gap-2 rounded-md border bg-card px-4 py-3 active:opacity-80 ${border}${state === "dim" ? " opacity-50" : ""}`}
    >
      {state === "correct" ? <Icon name="circle-check" size="sm" className="text-success" /> : null}
      {state === "wrong" ? <Icon name="circle-x" size="sm" className="text-destructive" /> : null}
      <Text className={`${text} leading-none`}>{label}</Text>
    </Pressable>
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

function PracticeResults({ practice, onAgain }: { practice: PracticeView; onAgain: () => void }) {
  const exercises = practice.session?.exercises ?? [];
  const items = practice.results?.items ?? [];
  // Index the misses by position so the row can quote the exercise's own
  // prompt and the option that was right, rather than the raw cloze (#46 review S2).
  const again = items.map((item, index) => ({ item, index })).filter(({ item }) => !item.correct);
  const totalExercises = exercises.length;
  return (
    <Card>
      <Text className="text-title font-semibold text-foreground">Session complete</Text>
      <Text className="text-body text-muted-foreground">
        {practice.results?.correct ?? 0} of {practice.results?.total ?? 0} correct -{" "}
        {totalExercises} exercise{totalExercises === 1 ? "" : "s"} from your Focus Set.
      </Text>
      {again.length > 0 ? (
        <View className="gap-3">
          <Text className="text-small text-muted-foreground">Needs another look</Text>
          {again.map(({ item, index }) => {
            const exercise = practice.exercises[index];
            const answer = exercise?.options.find((opt) => opt.id === exercise.feedback?.correctOptionId)?.text;
            return (
              <View
                key={`${item.itemKind}:${item.itemRef}:${index}`}
                testID={`practice-review-${index}`}
                className="flex-row flex-wrap items-center gap-3 border-b border-border pb-3"
              >
                <Icon name="circle-x" size="sm" className="text-destructive" />
                <View className="min-w-40 flex-1 gap-1">
                  <Text className="text-body text-foreground" numberOfLines={2}>
                    {exercise ? displayPrompt(exercise.prompt) : item.itemRef}
                  </Text>
                  {answer ? (
                    <Text className="text-small text-foreground">Correct answer: {answer}</Text>
                  ) : null}
                </View>
                <Text className="text-caption text-muted-foreground">{humanKind(item.itemKind)}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text className="text-body text-muted-foreground">Nothing to revisit this time.</Text>
      )}
      <PrimaryAction label="Practice again" onPress={onAgain} />
    </Card>
  );
}

/** The one filled action style on this screen (plan 2.5: 8 px radius, 44 px tall). */
function PrimaryAction({
  label,
  icon,
  onPress,
  innerRef,
}: {
  label: string;
  icon?: "chevron-right";
  onPress: () => void;
  /** Lets a caller focus this control when it appears (S5). */
  innerRef?: Ref<ViewInstance>;
}) {
  return (
    <Pressable
      ref={innerRef}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-11 flex-row items-center justify-center gap-2 self-stretch rounded-md bg-primary px-4 active:opacity-80"
    >
      <Text className="text-body font-semibold text-primary-foreground">{label}</Text>
      {icon ? <Icon name={icon} size="sm" className="text-primary-foreground" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Top-aligned column with a fixed top inset, card capped (plan 4.3). It is
  // deliberately not vertically centred: when feedback appears below the
  // options, a centred column shifts the whole card up under the Learner's
  // eyes (#46 review S3 — the progress bar's y must not move).
  page: { flexGrow: 1, alignItems: "center", paddingTop: 24, paddingHorizontal: 16 },
  column: { width: "100%", maxWidth: CARD_MAX_WIDTH, gap: 16 },
});
