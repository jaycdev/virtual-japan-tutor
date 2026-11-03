import type { ApiClient } from "@vjt/api-client";
import { usePractice, type ExerciseView, type PracticeView } from "@vjt/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Icon } from "./components/ui/icon.tsx";
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

/**
 * A deterministic session seed for a Story id (the reader footer's
 * /practice?story=<id> link). The API's PracticeSessionStart takes only an
 * integer seed, not a Story reference, so the client derives one from the id:
 * the same Story and Focus Set produce the same session, and retrying the
 * link never reshuffles it. Content seeding from the Story itself waits on
 * the API (see the issue #46 notes).
 */
export function practiceSeedForStory(storyId: string): number {
  let hash = 5381;
  for (let i = 0; i < storyId.length; i += 1) hash = ((hash << 5) + hash + storyId.charCodeAt(i)) >>> 0;
  return hash;
}

export function Practice({ client, seed }: { client: ApiClient; seed?: number }) {
  const practice = usePractice(client);
  // The exercise on screen. It stays up after answering so the Learner sees
  // what was right — even after the last answer flips the session to done;
  // Continue is what moves on to the results.
  const [shownId, setShownId] = useState<string | null>(null);
  // The answer the Learner last tried, so the InlineError's Retry can re-post
  // it when the answer POST failed (#46 review B3).
  const lastAttempt = useRef<{ exerciseId: string; optionId: string } | null>(null);

  // Deep-linked from a Story footer (#46): no Start tap — the session begins
  // immediately, seeded from the Story so the link is reproducible. The ref
  // keeps Strict Mode's double effect from posting two starts.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (seed === undefined || autoStarted.current) return;
    autoStarted.current = true;
    void practice.start(seed);
  }, [practice, seed]);

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

  return (
    <ScrollView
      className="flex-1"
      accessibilityLabel="Practice Session"
      contentContainerStyle={styles.page}
    >
      <View className="w-full gap-4" style={styles.column}>
        {practice.state === "idle" || practice.state === "error" ? (
          <StartPractice practice={practice} />
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
            ) : (
              <PracticeResults practice={practice} />
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
                onAnswer={(exerciseId, optionId) => {
                  setShownId(exerciseId);
                  lastAttempt.current = { exerciseId, optionId };
                  void practice.answer(exerciseId, optionId);
                }}
              />
            ) : (
              <Text className="text-body text-muted-foreground">The next exercise is on its way…</Text>
            );
          })()
        )}
      </View>
    </ScrollView>
  );
}

/** Card shell shared by the start, exercise and results states (plan 4.3). */
function Card({ children }: { children: ReactNode }) {
  return (
    <View testID="practice-card" className="gap-4 rounded-lg border border-border bg-card p-5">
      {children}
    </View>
  );
}

function StartPractice({ practice }: { practice: PracticeView }) {
  return (
    <Card>
      {practice.error ? (
        <InlineError message={practice.error} onRetry={() => void practice.start()} />
      ) : null}
      <Text className="text-body text-muted-foreground">
        A session is about twenty exercises drawn from your Focus Set — recognition and grammar
        cloze — and every answer feeds your mastery record.
      </Text>
      <PrimaryAction label="Start a practice session" onPress={() => void practice.start()} />
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
  // The label names the exercise on screen, not "one past the answered count":
  // the card keeps showing an answered exercise while its feedback is up, and
  // the count-based label read "Exercise 2 of 2" over Exercise 1's feedback
  // (#46 review B1).
  const position = practice.exercises.findIndex((ex) => ex.id === current.id) + 1;
  // Settled once the answer landed; pending covers the request in flight, so
  // a double-click cannot post the same answer twice.
  const settled = feedback !== null;
  const locked = settled || practice.pending;
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
        <Text className="text-display text-foreground font-serif">{current.prompt}</Text>
        {feedback ? (
          <View accessibilityRole="status" className="flex-row flex-wrap items-center gap-2">
            <Icon
              name={feedback.correct ? "circle-check" : "circle-x"}
              size="sm"
              className={feedback.correct ? "text-success" : "text-destructive"}
            />
            <Text className={feedback.correct ? "text-body font-semibold text-success" : "text-body font-semibold text-destructive"}>
              {feedback.correct ? "Correct" : "Not quite"}
            </Text>
          </View>
        ) : null}
        <View className="gap-2">
          {current.options.map((opt) => {
            const chosen = feedback !== null && feedback.chosenOptionId === opt.id;
            const right = feedback !== null && feedback.correctOptionId === opt.id;
            const mark = !feedback ? "" : right ? " ← correct" : chosen ? " ← your answer" : "";
            return (
              <OptionButton
                key={opt.id}
                label={opt.text}
                mark={mark}
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
          <PrimaryAction label="Continue" icon="chevron-right" onPress={onContinue} />
        ) : null}
      </Card>
    </View>
  );
}

function OptionButton({
  label,
  mark,
  state,
  disabled,
  onPress,
}: {
  label: string;
  /** The " ← correct" / " ← your answer" marker once the answer has landed. */
  mark: string;
  state: "open" | "correct" | "wrong" | "dim";
  disabled: boolean;
  onPress: () => void;
}) {
  const border =
    state === "correct" ? "border-success" : state === "wrong" ? "border-destructive" : "border-border";
  const text =
    state === "correct"
      ? "text-title text-success"
      : state === "wrong"
        ? "text-title text-destructive"
        : "text-title text-foreground";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}${mark}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 flex-row flex-wrap items-center justify-center gap-2 rounded-md border bg-card px-4 active:opacity-80 ${border}${state === "dim" ? " opacity-50" : ""}`}
    >
      {state === "correct" ? <Icon name="circle-check" size="sm" className="text-success" /> : null}
      {state === "wrong" ? <Icon name="circle-x" size="sm" className="text-destructive" /> : null}
      <Text className={text}>{label}</Text>
      {mark ? <Text className="text-small text-muted-foreground">{mark}</Text> : null}
    </Pressable>
  );
}

function PracticeResults({ practice }: { practice: PracticeView }) {
  const exercises = practice.session?.exercises ?? [];
  const items = practice.results?.items ?? [];
  const again = items.filter((item) => !item.correct);
  return (
    <Card>
      <Text className="text-title font-semibold text-foreground">
        Session complete — {practice.results?.correct ?? 0} of {practice.results?.total ?? 0} correct.
      </Text>
      {again.length > 0 ? (
        <View className="gap-3">
          <Text className="text-small text-muted-foreground">Needs another look</Text>
          {again.map((item) => {
            const i = items.indexOf(item);
            return (
              <View
                key={`${item.itemKind}:${item.itemRef}:${i}`}
                testID={`practice-review-${i}`}
                className="flex-row flex-wrap items-center gap-3 border-b border-border pb-3"
              >
                <Icon name="circle-x" size="sm" className="text-destructive" />
                <Text className="flex-1 text-body text-foreground" numberOfLines={2}>
                  {exercises[i]?.prompt ?? item.itemRef}
                </Text>
                <Text className="text-caption text-muted-foreground">{item.itemKind}</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <Text className="text-body text-muted-foreground">Nothing to revisit this time.</Text>
      )}
      <PrimaryAction label="Practice again" onPress={() => void practice.start()} />
    </Card>
  );
}

/** The one filled action style on this screen (plan 2.5: 8 px radius, 44 px tall). */
function PrimaryAction({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon?: "chevron-right";
  onPress: () => void;
}) {
  return (
    <Pressable
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
  // Centred column, card capped (plan 4.3); the content centres vertically
  // while short and scrolls once the results list outgrows the viewport.
  page: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  column: { width: "100%", maxWidth: CARD_MAX_WIDTH, gap: 16 },
});
