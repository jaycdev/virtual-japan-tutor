import type { ApiClient } from "@vjt/api-client";
import {
  createFocusLabelResolver,
  focusChipKey,
  focusChipLabel,
  useFocusChipLabels,
  useT,
  type FocusLabelResolver,
  type FocusSetView,
} from "@vjt/core";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { T } from "../../components/Text.tsx";
import { EmptyState, InlineError, SkeletonBar } from "../../state/states.tsx";

/**
 * The Focus Set panel: one list with the states and "show all" behaviour the
 * Today glance needs (plan 4.4 item 4). Practice shows its own copy of the
 * set today; when Practice is rebuilt it should render this component rather
 * than duplicating the list. The chip labels are @vjt/core's (issue #79).
 */

/**
 * How many chips the Today glance shows before "See all" (plan 4.4 item 4:
 * "up to about 8").
 */
export const FOCUS_CHIPS_MAX = 8;


export function FocusSetPanel({
  focus,
  client,
  resolveLabel,
  onOpenWordLists,
  max = Number.POSITIVE_INFINITY,
}: {
  focus: FocusSetView;
  /** Used to look up vocabulary/grammar chip labels (B1). */
  client: ApiClient;
  /** Lookup for one chip's label; defaults to the two catalogue endpoints. */
  resolveLabel?: FocusLabelResolver;
  /** Empty-state action: take the Learner to their Item Lists. */
  onOpenWordLists?: () => void;
  /** Cap on the chips shown before "See all" (the Today glance passes 8). */
  max?: number;
}) {
  const items = useMemo(() => focus.items ?? [], [focus.items]);
  const { tp } = useT();
  // The Focus Set arrives before the Learner chooses to open it, and screen
  // readers announce every chip the moment it does - dozens at a time on the
  // ~100-item sets real Learners have (#46 review P8). Only the first `max` are
  // announced; "See all" is what reveals the rest, both to the eye and to the
  // screen reader.
  const [expanded, setExpanded] = useState(false);
  const cap = Math.max(1, max);
  // The resolver is memoised so the label effect keys on a stable function:
  // an inline default would restart the (already cached) lookup on every
  // render (issue #47 review B1, lint react-hooks/refs).
  const resolve = useMemo(
    () => resolveLabel ?? createFocusLabelResolver(client),
    [resolveLabel, client],
  );
  // shown is derived, so it only changes when the set or the cap does; that is
  // what the label hook watches.
  const shown = useMemo(
    () => (expanded ? items : items.slice(0, cap)),
    [expanded, items, cap],
  );
  // The button only appears, and the status line only matters, when there is
  // more behind the cap than is on screen.
  const hidden = Math.max(0, items.length - shown.length);
  const labels = useFocusChipLabels(client, shown, resolve);
  return (
    <View className="gap-3">
      <T
        k="mobile.focusHeading"
        className="text-title font-semibold text-foreground"
        accessibilityRole="header"
      />
      <T k="mobile.focusNote" className="text-small text-muted-foreground" />
      {focus.loading ? (
        // A row of chip-shaped bars, the shape the settled panel shows
        // (issue #47 review S7).
        <View className="flex-row flex-wrap gap-2">
          <SkeletonBar width={88} height={30} />
          <SkeletonBar width={104} height={30} />
          <SkeletonBar width={72} height={30} />
        </View>
      ) : focus.error ? (
        // An InlineError with a Retry in place of the content that failed
        // (plan §5), not a message the Learner cannot act on.
        <InlineError message={focus.error} onRetry={focus.retry} />
      ) : items.length === 0 ? (
        // A one-line explanation and one action, not the old raw "No items."
        <EmptyState
          compact
          message={<T k="mobile.focusEmpty" className="text-center text-body text-muted-foreground" />}
          actionLabel={<T k="practice.openLists" className="text-body font-semibold text-primary" />}
          onAction={onOpenWordLists}
        />
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {shown.map((item, index) => {
            const label = labels[focusChipKey(item)];
            const lookingUp = item.kind !== "kanji" && label === undefined;
            return (
              <View
                key={focusChipKey(item)}
                // Past the announced cap the chips stay on screen but out of the
                // screen reader's way (P8); a hidden subtree also drops its
                // descendants, so this keeps them readable.
                accessible={index < cap || expanded}
                className="flex-row items-center gap-1.5 rounded-full border border-focus/40 bg-focus/10 px-3 py-1.5"
              >
                {lookingUp ? (
                  // Skeleton while the label resolves, so the chip never
                  // flashes an id the Learner cannot read (B1).
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    className="animate-pulse rounded-md bg-muted"
                    style={{ width: 64, height: 14 }}
                  />
                ) : (
                  // The chip text is Japanese - a kanji literal or a resolved
                  // headword/pattern - so the screen reader says it in Japanese.
                  // (RN 0.88 Text has no `lang` prop; accessibilityLanguage is
                  // the one that exists on both hosts.) The testID marks it as
                  // Learner content for the furigana coverage check, the way
                  // web's lang="ja" does.
                  <Text accessibilityLanguage="ja" testID="focus-chip-label" className="text-small text-foreground">
                    {label ?? focusChipLabel(item)}
                  </Text>
                )}
                {item.srsLevel !== null && item.srsLevel !== undefined ? (
                  <T
                    k="reader.srs"
                    params={{ level: item.srsLevel }}
                    className="text-caption text-muted-foreground"
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      {items.length > cap ? (
        <View className="gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              expanded
                ? tp("mobile.focusShowFewerAria")
                : tp("mobile.focusShowAllAria", { count: items.length })
            }
            // A plain Pressable stays in the tab order once it is disabled
            // (#46 review P5); accessibilityState keeps the screen reader honest
            // about it too.
            accessibilityState={{ disabled: focus.loading }}
            disabled={focus.loading}
            onPress={() => setExpanded((value) => !value)}
            className="min-h-11 flex-row items-center justify-center rounded-md border border-border bg-card px-4 active:opacity-80"
          >
            <T
              k={expanded ? "mobile.focusShowFewer" : "today.seeAll"}
              className="text-body text-foreground"
            />
          </Pressable>
          {/* Not announced on load: this line only matters once the Learner
              presses the button, and a polite live region would also read it
              while the set is still arriving under the cap. */}
          <View accessibilityLiveRegion="polite">
            {hidden > 0 ? (
              <T
                k="mobile.focusShownCount"
                params={{ shown: shown.length, total: items.length }}
                className="text-caption text-muted-foreground"
              />
            ) : (
              <T
                k="mobile.focusShownAll"
                params={{ total: items.length }}
                className="text-caption text-muted-foreground"
              />
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}
