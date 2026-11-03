import type { ApiClient, FocusSetItem } from "@vjt/api-client";
import type { FocusSetView } from "@vjt/core";
import { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { EmptyState, InlineError, SkeletonBar } from "../../state/states.tsx";

/**
 * The Focus Set panel: one list with the states and "show all" behaviour the
 * Today glance needs (plan 4.4 item 4). Practice shows its own copy of the
 * set today; when Practice is rebuilt it should render this component rather
 * than duplicating the list.
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
 * A Focus Set item as a chip label before its lookup resolves. The kanji
 * literal is already the label; for vocabulary and grammar `itemRef` is only
 * an id - a JMdict ent_seq or a Grammar Catalogue point id - so it stands in
 * until (issue #47 review B1) the lookup below supplies the real word or
 * pattern, and remains on screen only if that lookup fails.
 */
export function focusChipLabel(item: FocusSetItem): string {
  return item.kind === "kanji" ? item.itemRef : `${focusKindWord(item.kind)} ${item.itemRef}`;
}

/**
 * A chip cache key. itemRefs are unique per kind (an ent_seq and a grammar
 * point id can be the same digits), so the kind is part of the key.
 */
function chipKey(item: FocusSetItem): string {
  return `${item.kind}:${item.itemRef}`;
}

/**
 * Label resolution for one vocabulary/grammar chip, and null when the item
 * has no readable label to fetch.
 */
export type FocusChipLabel = string | null;

export type FocusLabelResolver = (item: FocusSetItem) => Promise<FocusChipLabel>;

/**
 * The labels for shown chips come from the two catalogues Today already talks
 * to (issue #47 review B1): GET /dictionary/entries/{entSeq} for vocabulary
 * (headword plus reading, the same form the Lookup window shows) and
 * GET /grammar/points/{id} for grammar (the teaching pattern, e.g. 〜てしまう).
 * Kanji chips need no lookup: their itemRef is the literal.
 */
export function createFocusLabelResolver(client: ApiClient): FocusLabelResolver {
  return async (item) => {
    if (item.kind === "vocabulary") {
      const res = await client.GET("/dictionary/entries/{entSeq}", {
        params: { path: { entSeq: item.itemRef } },
      });
      const entry = res.data;
      if (!entry || !entry.found || !entry.headword) return null;
      return entry.reading && entry.reading !== entry.headword
        ? `${entry.headword} (${entry.reading})`
        : entry.headword;
    }
    if (item.kind === "grammar") {
      const res = await client.GET("/grammar/points/{id}", {
        params: { path: { id: item.itemRef } },
      });
      return res.data?.pattern || null;
    }
    return null;
  };
}

/**
 * Resolved labels for the Focus Set chips, cached per ApiClient. The cache
 * lives outside React (a WeakMap on the client, which the App rebakes once per
 * session) so "See all" never refetches the first eight chips and a Sync
 * refresh reuses the words it already knows. A failed lookup caches null and
 * stays the fallback - Retry on the focus set itself is what would try again.
 * The resolver is held in a ref so callers can pass an inline function without
 * restarting the lookup effect on every render.
 */
const labelCaches = new WeakMap<ApiClient, Map<string, Promise<FocusChipLabel>>>();

function labelPromise(
  cache: Map<string, Promise<FocusChipLabel>>,
  resolve: FocusLabelResolver,
  item: FocusSetItem,
): Promise<FocusChipLabel> {
  const key = chipKey(item);
  let promise = cache.get(key);
  if (!promise) {
    // The cached promise never rejects: a failed lookup settles to null so
    // the chip can fall back to its id instead of poisoning the cache.
    promise = Promise.resolve()
      .then(() => resolve(item))
      .catch(() => null);
    cache.set(key, promise);
  }
  return promise;
}

export function useFocusChipLabels(
  client: ApiClient,
  items: FocusSetItem[],
  resolve: FocusLabelResolver,
): Record<string, FocusChipLabel | undefined> {
  const [labels, setLabels] = useState<Record<string, FocusChipLabel>>({});
  const resolver = useRef(resolve);
  resolver.current = resolve;
  useEffect(() => {
    let cache = labelCaches.get(client);
    if (!cache) {
      cache = new Map();
      labelCaches.set(client, cache);
    }
    const lookup = cache;
    let live = true;
    for (const item of items) {
      if (item.kind === "kanji") continue;
      const key = chipKey(item);
      void labelPromise(lookup, (i) => (resolver.current as FocusLabelResolver)(i), item).then((label) => {
        if (live) setLabels((prev) => ({ ...prev, [key]: label }));
      });
    }
    return () => {
      live = false;
    };
  }, [client, items, resolver]);
  return labels;
}

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
  const labels = useFocusChipLabels(client, shown, resolveLabel ?? createFocusLabelResolver(client));
  return (
    <View className="gap-3">
      <Text
        role="heading"
        accessibilityRole="header"
        className="text-title font-semibold text-foreground"
      >
        Your Focus Set
      </Text>
      <Text className="text-small text-muted-foreground">
        These are the items Practice builds a session from.
      </Text>
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
          message="No items in your Focus Set yet"
          actionLabel="Open your word lists"
          onAction={onOpenWordLists}
        />
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {shown.map((item, index) => {
            const label = labels[chipKey(item)];
            const lookingUp = item.kind !== "kanji" && label === undefined;
            return (
              <View
                key={chipKey(item)}
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
                  // the one that exists on both hosts.)
                  <Text accessibilityLanguage="ja" className="text-small text-foreground">
                    {label ?? focusChipLabel(item)}
                  </Text>
                )}
                {item.srsLevel !== null && item.srsLevel !== undefined ? (
                  <Text className="text-caption text-muted-foreground">SRS {item.srsLevel}</Text>
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
