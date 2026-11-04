import type { ApiClient, GrammarReviewItem } from "@vjt/api-client";
import { STARTING_LEVELS, useGrammarReview, useStartingLevel, type StartingLevel } from "@vjt/core";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { Chip, ChipRow } from "./components/ui/Chip.tsx";
import { ActionButton } from "./stories-parts.tsx";
import { InlineError, SkeletonBar } from "./state/states.tsx";
import type { StepSaveHandle, StepSaveOutcome } from "./settingsSections.tsx";

/**
 * Starting Level (#6, on the #50 hub): N5–N1 chips pick the level; saving
 * re-applies Seeded Grammar and reports the server's counts. Below the
 * picker, the read-only "Review these grammar matches" list from the same
 * issue — Catalogue Matching outcomes the Learner may want to glance at.
 * First-run setup shows this same component as its first step, so the
 * Settings section and the setup screen cannot drift apart — and the
 * wizard's Next/Finish runs this section's save through `saveHandle`
 * (review S2).
 */
export function StartingLevelSettings({
  client,
  saveHandle,
}: {
  client: ApiClient;
  /** Registered by the setup wizard; absent under the Settings hub. */
  saveHandle?: StepSaveHandle;
}) {
  const level = useStartingLevel(client);
  const [choice, setChoice] = useState<StartingLevel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [result, setResult] = useState<string | undefined>();

  const stored = level.state.status === "ready" ? level.state.level.level : null;
  const selected = choice ?? stored ?? "N5";

  const save = async () => {
    setBusy(true);
    setError(undefined);
    setResult(undefined);
    try {
      const res = await level.setLevel(selected);
      if ("status" in res) setError(res.message);
      else setResult(`Grammar updated: ${res.added ?? 0} added, ${res.removed ?? 0} removed.`);
    } finally {
      setBusy(false);
    }
  };

  // S2: the wizard's Next/Finish runs the step's entered input through the
  // same setLevel path the Save button uses. No pick yet is "nothing" —
  // there is nothing to write, and the wizard may move on.
  useEffect(() => {
    if (!saveHandle) return;
    saveHandle.current = async (): Promise<StepSaveOutcome> => {
      if (choice === null) return "nothing";
      const res = await level.setLevel(choice);
      if ("status" in res) {
        setError(res.message);
        return "blocked";
      }
      setResult(`Grammar updated: ${res.added ?? 0} added, ${res.removed ?? 0} removed.`);
      setChoice(null);
      return "saved";
    };
    return () => {
      saveHandle.current = null;
    };
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
        message={`Cannot load your Starting Level: ${level.state.message}`}
        onRetry={level.reload}
      />
    );
  }

  return (
    <View className="gap-4">
      <Text className="text-body text-foreground">
        {level.state.level.configured
          ? `Starting level: ${level.state.level.level}`
          : "Not chosen yet. Pick one to mark everything at or below it as known."}
      </Text>
      <Card>
        <ChipRow>
          {STARTING_LEVELS.map((l) => (
            <Chip key={l} label={l} selected={selected === l} onPress={() => setChoice(l)} />
          ))}
        </ChipRow>
      </Card>
      <ActionButton label="Save level" onPress={() => void save()} filled disabled={busy} />
      {result && (
        <Text role="status" accessibilityLiveRegion="polite" className="text-body text-success">
          {result}
        </Text>
      )}
      {error && <InlineError message={error} />}

      {/* S5: the read-only "review these" list (issue #6) — dropped from the
          legacy mobile settings by the hub rebuild and restored here, in the
          same section it sits under on web. Nothing to change: the list is
          the outcome of Catalogue Matching on the last Syncs. */}
      <GrammarReviewList client={client} />
    </View>
  );
}

const reviewText = (item: GrammarReviewItem): string =>
  `${item.pattern || item.marumoriId}` +
  (item.jlptLevel ? ` (MaruMori level ${item.jlptLevel})` : "") +
  (item.matchedPointId ? ` — matched point ${item.matchedPointId}, level was ambiguous` : " — no Grammar Catalogue match");

function GrammarReviewList({ client }: { client: ApiClient }) {
  const review = useGrammarReview(client);
  return (
    <View className="gap-2">
      <Text accessibilityRole="header" className="text-title-sm font-semibold text-foreground">
        Review these grammar matches
      </Text>
      {review.state.status === "loading" ? <SkeletonBar width="60%" height={20} /> : null}
      {review.state.status === "error" ? (
        <InlineError message={`Cannot load the review list: ${review.state.message}`} onRetry={review.reload} />
      ) : null}
      {review.state.status === "ready" && review.state.items.length === 0 ? (
        <Text className="text-body text-muted-foreground">Nothing needs a second look.</Text>
      ) : null}
      {review.state.status === "ready" && review.state.items.length > 0 ? (
        <>
          <Text className="text-small text-muted-foreground">
            These MaruMori grammar points did not match the Catalogue cleanly. They re-check
            themselves on later Syncs.
          </Text>
          {review.state.items.map((item) => (
            <Text key={item.marumoriId} className="text-body text-foreground">
              {reviewText(item)}
            </Text>
          ))}
        </>
      ) : null}
    </View>
  );
}
