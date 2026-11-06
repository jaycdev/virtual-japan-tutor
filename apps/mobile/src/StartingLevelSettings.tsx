import type { ApiClient } from "@vjt/api-client";
import {
  STARTING_LEVELS,
  grammarReviewTailRuby,
  grammarUpdatedRuby,
  useGrammarReview,
  useStartingLevel,
  useT,
  type StartingLevel,
  type StepSaveOutcome,
  type StepSaveRegistrar,
} from "@vjt/core";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { T, TableText } from "./components/Text.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";

/**
 * Starting Level (#6, on the #50 hub): N5–N1 chips pick the level; saving
 * re-applies Seeded Grammar and reports the server's counts. Below the
 * picker, the read-only "Review these grammar matches" list from the same
 * issue — Catalogue Matching outcomes the Learner may want to glance at.
 * First-run setup shows this same component as its first step, so the
 * Settings section and the setup screen cannot drift apart — and the
 * wizard's Next/Finish runs this section's save through the `registerSave`
 * contract (review S2).
 */
export function StartingLevelSettings({
  client,
  registerSave,
}: {
  client: ApiClient;
  /** Handed the step-save by the setup wizard; absent under the Settings hub. */
  registerSave?: StepSaveRegistrar;
}) {
  const level = useStartingLevel(client);
  const [choice, setChoice] = useState<StartingLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<{ added?: number; removed?: number } | undefined>();

  const stored = level.state.status === "ready" ? level.state.level.level : null;
  const selected = choice ?? stored ?? "N5";
  const { language } = useT();

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const res = await level.setLevel(selected);
      if ("status" in res) setError(res.message);
      // Server data, not a resolved sentence: the line is drawn in whatever
      // Interface Language is current when it renders (issue #125, B3).
      else setResult({ added: res.added, removed: res.removed });
    } finally {
      setBusy(false);
    }
  };

  // S2: the wizard's Next/Finish runs the step's entered input through the
  // same setLevel path the Save button uses. No pick yet is "nothing" —
  // there is nothing to write, and the wizard may move on. The effect has
  // no dep list on purpose: the save is re-registered after every render,
  // so what the Learner last picked is what Next saves.
  useEffect(() => {
    if (!registerSave) return;
    registerSave(async (): Promise<StepSaveOutcome> => {
      if (choice === null) return "nothing";
      const res = await level.setLevel(choice);
      if ("status" in res) {
        setError(res.message);
        return "blocked";
      }
      setResult({ added: res.added, removed: res.removed });
      setChoice(null);
      return "saved";
    });
    return () => registerSave(null);
  });

  if (level.state.status === "loading") {
    // Shaped like the picker it replaces: a line of prose and the chip row.
    return (
      <View className="gap-4">
        <SkeletonBar width="80%" height={24} />
        <SkeletonBar width="100%" height={44} />
      </View>
    );
  }
  if (level.state.status === "error") {
    return (
      <InlineError
        message={<T k="settings.levelLoadFailed" params={{ message: level.state.message }} />}
        onRetry={level.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      {level.state.level.configured ? (
        <T k="settings.levelCurrent" params={{ level: level.state.level.level ?? "" }} className="text-body text-foreground" />
      ) : (
        <T k="settings.levelUnset" className="text-body text-foreground" />
      )}
      <Card>
        <ChipRow>
          {STARTING_LEVELS.map((l) => (
            <Chip key={l} label={l} selected={selected === l} onPress={() => setChoice(l)} />
          ))}
        </ChipRow>
      </Card>
      <ActionButton label={<T k="settings.levelSave" />} onPress={() => void save()} filled disabled={busy} />
      {result && (
        // The live status line, drawn in the Interface Language: TableText's
        // own roles do not include "status", so the wrapper carries it, as
        // ServerSettings and ReadingSettingsSection do.
        <View role="status" accessibilityLiveRegion="polite">
          <TableText segments={grammarUpdatedRuby(result, language)} className="text-body text-success" />
        </View>
      )}
      {error && <InlineError message={error} />}

      {/* S5: the read-only "review these" list (issue #6) — dropped from the
          legacy mobile settings by the hub rebuild and restored here, in the
          same section it sits under. Nothing to change: the list is
          the outcome of Catalogue Matching on the last Syncs. */}
      <GrammarReviewList client={client} />
    </View>
  );
}

function GrammarReviewList({ client }: { client: ApiClient }) {
  const review = useGrammarReview(client);
  const { language } = useT();
  return (
    <View className="gap-2">
      <T
        k="settings.levelReviewHeading"
        className="text-title-sm font-semibold text-foreground"
        accessibilityRole="header"
      />
      {review.state.status === "loading" ? <SkeletonBar width="60%" height={20} /> : null}
      {review.state.status === "error" ? (
        <InlineError
          message={<T k="settings.reviewLoadFailed" params={{ message: review.state.message }} />}
          onRetry={review.reload}
        />
      ) : null}
      {review.state.status === "ready" && review.state.items.length === 0 ? (
        <T k="settings.reviewEmpty" className="text-body text-muted-foreground" />
      ) : null}
      {review.state.status === "ready" && review.state.items.length > 0 ? (
        <>
          <T k="settings.reviewNote" className="text-small text-muted-foreground" />
          {review.state.items.map((item) => (
            // The Pattern is Learner-catalogue content and rides unannotated;
            // the coverage check exempts just that piece, by its testID — the
            // connectives beside it are ours, and stay under the check.
            <View key={item.marumoriId} testID="grammar-review-row" className="flex-row flex-wrap items-end">
              <Text testID="grammar-review-pattern" className="text-body text-foreground">
                {item.pattern || item.marumoriId}
              </Text>
              <TableText
                segments={grammarReviewTailRuby(item, language)}
                className="text-body text-foreground"
              />
            </View>
          ))}
        </>
      ) : null}
    </View>
  );
}
