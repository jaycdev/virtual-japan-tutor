import type { ApiClient } from "@vjt/api-client";
import { usePractice, type ExerciseView, type PracticeView } from "@vjt/core";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MIN_TOUCH, useColors } from "./theme.ts";
import { Body, ErrorText, Muted, PrimaryButton, StatusText } from "./ui.tsx";

/**
 * Practice Sessions (issue #9, on mobile for issue #13): the same flow as the
 * web screen — one session drawn from the Focus Set, one exercise at a time,
 * every answer recorded server-side. The exercise on screen stays up after
 * answering so the Learner sees what was right; Continue moves on.
 */
export function Practice({ client }: { client: ApiClient }) {
  const practice = usePractice(client);
  // The exercise on screen. It stays up after answering so the Learner sees
  // what was right — even after the last answer flips the session to done;
  // Continue is what moves on to the results.
  const [shownId, setShownId] = useState<string | null>(null);

  return (
    <View style={styles.column}>
      {practice.error ? <ErrorText text={practice.error} /> : null}
      {practice.state === "idle" || practice.state === "error" ? (
        <StartPractice practice={practice} />
      ) : practice.state === "starting" ? (
        <Muted text="Building your session from the Focus Set…" />
      ) : practice.state === "done" ? (
        // The final answer's feedback stays on screen until Continue, so the
        // Learner sees the last exercise's result too.
        (() => {
          const shown = shownId ? practice.exercises.find((ex) => ex.id === shownId) : undefined;
          return shown && shown.feedback ? (
            <ActivePractice
              practice={practice}
              current={shown}
              onContinue={() => setShownId(null)}
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
              onContinue={() => setShownId(null)}
              onAnswer={(exerciseId, optionId) => {
                setShownId(exerciseId);
                void practice.answer(exerciseId, optionId);
              }}
            />
          ) : (
            <Muted text="The next exercise is on its way…" />
          );
        })()
      )}
    </View>
  );
}

function StartPractice({ practice }: { practice: PracticeView }) {
  return (
    <View style={styles.column}>
      <Body text="A session is about twenty exercises drawn from your Focus Set — recognition and grammar cloze — and every answer feeds your mastery record." />
      <PrimaryButton label="Start a practice session" onPress={() => void practice.start()} />
    </View>
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
  const colors = useColors();
  const answeredCount = practice.exercises.filter((ex) => ex.answered).length;
  const skipped = practice.session?.skipped ?? 0;
  const feedback = current.feedback;
  // Settled once the answer landed; pending covers the request in flight, so
  // a double-click cannot post the same answer twice.
  const settled = feedback !== null;
  const locked = settled || practice.pending;
  return (
    <View style={styles.column}>
      <Muted
        text={`Exercise ${Math.min(answeredCount + 1, practice.target)} of ${practice.target}` +
          (skipped > 0 ? ` (${skipped} Focus Set item${skipped === 1 ? "" : "s"} without content, skipped)` : "")}
      />
      <Body text={current.instruction} />
      <Text style={[styles.prompt, { color: colors.label }]}>{current.prompt}</Text>
      {feedback ? <StatusText text={feedback.correct ? "Correct" : "Not quite"} ok={feedback.correct} /> : null}
      <View style={styles.column}>
        {current.options.map((opt) => {
          const chosen = feedback !== null && feedback.chosenOptionId === opt.id;
          const right = feedback !== null && feedback.correctOptionId === opt.id;
          const mark = !feedback ? "" : right ? " ← correct" : chosen ? " ← your answer" : "";
          return (
            <OptionButton
              key={opt.id}
              label={`${opt.text}${mark}`}
              state={feedback === null ? "open" : right ? "correct" : chosen ? "wrong" : "dim"}
              disabled={locked}
              onPress={() => onAnswer(current.id, opt.id)}
            />
          );
        })}
      </View>
      {settled ? <PrimaryButton label="Continue" onPress={onContinue} /> : null}
    </View>
  );
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
  const colors = useColors();
  const border =
    state === "correct" ? colors.success : state === "wrong" ? colors.danger : colors.separator;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        {
          borderColor: border,
          backgroundColor: colors.card,
          opacity: state === "dim" ? 0.6 : pressed ? 0.85 : disabled ? 0.9 : 1,
        },
      ]}
    >
      <Text style={{ color: colors.label, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

function PracticeResults({ practice }: { practice: PracticeView }) {
  const exercises = practice.session?.exercises ?? [];
  const colors = useColors();
  return (
    <View style={styles.column}>
      <StatusText
        text={`Session complete — ${practice.results?.correct ?? 0} of ${practice.results?.total ?? 0} correct.`}
      />
      <View style={styles.column}>
        {/* results.items are in exercise order, so index into the session's exercises. */}
        {(practice.results?.items ?? []).map((item, i) => (
          <View
            key={`${item.itemKind}:${item.itemRef}:${i}`}
            style={[styles.resultRow, { borderBottomColor: colors.separator }]}
          >
            <Text style={[styles.resultPrompt, { color: colors.label }]} numberOfLines={2}>
              {exercises[i]?.prompt ?? item.itemRef}
            </Text>
            <Text style={{ color: colors.subtle }}>{item.itemKind}</Text>
            <Text style={{ color: item.correct ? colors.success : colors.danger }}>
              {item.correct ? "✓" : "✗"}
            </Text>
          </View>
        ))}
      </View>
      <PrimaryButton label="Practice again" onPress={() => void practice.start()} />
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: 12 },
  prompt: { fontSize: 20, fontWeight: "600" },
  option: {
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  resultPrompt: { flex: 1, fontSize: 15 },
});
