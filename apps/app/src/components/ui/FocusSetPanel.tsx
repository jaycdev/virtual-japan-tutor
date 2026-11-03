import type { FocusSetItem } from "@vjt/api-client";
import type { FocusSetView } from "@vjt/core";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { EmptyState, InlineError, Skeleton } from "../../state/states.tsx";

/**
 * The Focus Set panel: the same list, states and "show all" behaviour the
 * Practice start screen and the Today glance both need (plan 4.3 and 4.4
 * item 4). It takes the view the caller already has, so Today and Practice
 * show the identical thing from one implementation.
 */

/**
 * How many chips the Today glance shows before "See all" (plan 4.4 item 4:
 * "up to about 8").
 */
export const FOCUS_CHIPS_MAX = 8;

/**
 * The Focus Set in their own words (plan 4.3, P7): the API's `kind` reads as
 * the exercise type - "Grammar point", not "Grammar".
 */
export function focusKindWord(kind: FocusSetItem["kind"]): string {
  return kind === "grammar"
    ? "Grammar point"
    : kind === "vocabulary"
      ? "Word"
      : kind.charAt(0).toUpperCase() + kind.slice(1);
}

/**
 * A Focus Set item as a chip label. The API gives the kanji literal as
 * `itemRef`, but for vocabulary and grammar `itemRef` is only an id - a JMdict
 * ent_seq or a Grammar Catalogue point id - and the Focus Set payload carries
 * no reading or pattern, so the id is shown as itself rather than pretending
 * to know the word (reported in the issue #47 notes: a real label needs a
 * lookup the Focus Set endpoint does not do). Only the kanji literal reads as
 * Japanese, so only that chip gets the CJK language tag.
 */
export function focusChipLabel(item: FocusSetItem): string {
  return item.kind === "kanji" ? item.itemRef : `${focusKindWord(item.kind)} ${item.itemRef}`;
}

export function FocusSetPanel({
  focus,
  onOpenWordLists,
  max = Number.POSITIVE_INFINITY,
}: {
  focus: FocusSetView;
  /** Empty-state action: take the Learner to their word lists. */
  onOpenWordLists?: () => void;
  /** Cap on the chips shown before "See all" (the Today glance passes 8). */
  max?: number;
}) {
  const items = focus.items ?? [];
  // The Focus Set arrives before the Learner chooses to open it, and screen
  // readers announce every chip the moment it does - dozens at a time on the
  // ~100-item sets real Learners have (#46 review P8). Only the first `max` are
  // announced; "See all" is what reveals the rest, both to the eye and to the
  // screen reader.
  const [expanded, setExpanded] = useState(false);
  const cap = Math.max(1, max);
  const shown = expanded ? items : items.slice(0, cap);
  // The button only appears, and the status line only matters, when there is
  // more behind the cap than is on screen.
  const hidden = Math.max(0, items.length - shown.length);
  return (
    <View className="gap-3">
      <Text className="text-title font-semibold text-foreground">Your Focus Set</Text>
      <Text className="text-small text-muted-foreground">
        These are the items Practice builds a session from.
      </Text>
      {focus.loading ? (
        <Skeleton lines={3} lineHeight={24} />
      ) : focus.error ? (
        // An InlineError with a Retry in place of the content that failed
        // (plan §5), not a message the Learner cannot act on.
        <InlineError message={focus.error} onRetry={focus.retry} />
      ) : items.length === 0 ? (
        // A one-line explanation and one action, not the old raw "No items."
        <EmptyState
          message="No items in your Focus Set yet"
          actionLabel="Open your word lists"
          onAction={onOpenWordLists}
        />
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {shown.map((item, index) => (
            <View
              key={`${item.kind}:${item.itemRef}`}
              // Past the announced cap the chips stay on screen but out of the
              // screen reader's way (P8); a hidden subtree also drops its
              // descendants, so this keeps them readable.
              accessible={index < cap || expanded}
              className="flex-row items-center gap-1.5 rounded-full border border-focus/40 bg-focus/10 px-3 py-1.5"
            >
              <Text className="text-small text-foreground">{focusChipLabel(item)}</Text>
              {item.srsLevel !== null && item.srsLevel !== undefined ? (
                <Text className="text-caption text-muted-foreground">SRS {item.srsLevel}</Text>
              ) : null}
            </View>
          ))}
        </View>
      )}
      {items.length > cap ? (
        <View className="gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              expanded ? "Show fewer Focus Set items" : `Show all ${items.length} Focus Set items`
            }
            // A plain Pressable stays in the tab order once it is disabled
            // (#46 review P5); accessibilityState keeps the screen reader honest
            // about it too.
            accessibilityState={{ disabled: focus.loading }}
            disabled={focus.loading}
            onPress={() => setExpanded((value) => !value)}
            className="min-h-11 flex-row items-center justify-center rounded-md border border-border bg-card px-4 active:opacity-80"
          >
            <Text className="text-body text-foreground">{expanded ? "Show fewer" : "See all"}</Text>
          </Pressable>
          {/* Not announced on load: this line only matters once the Learner
              presses the button, and a polite live region would also read it
              while the set is still arriving under the cap. */}
          <Text accessibilityLiveRegion="polite" role="status" className="text-caption text-muted-foreground">
            {hidden > 0 ? `${shown.length} of ${items.length} Focus Set items shown` : `All ${items.length} Focus Set items shown`}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
