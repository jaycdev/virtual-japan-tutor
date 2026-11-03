import type { DictionaryEntry, StoryRating } from "@vjt/api-client";
import type { StoryView } from "@vjt/core";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "../components/ui/icon";
import { MIN_TOUCH } from "../theme";

/**
 * Small shared pieces of the mobile reader: the JLPT badge, the gloss helpers
 * (same cap rules as the web Lookup row), and the thumbs rating buttons.
 */

/** JLPT level pill — the caller passes the label it shows (`N2`). */
export function JlptBadge({ level }: { level: string }) {
  return (
    <View className="rounded-sm border-pitch bg-primary-subtle px-2" style={styles.badge}>
      <Text className="text-caption text-primary" style={styles.badgeText}>
        {level}
      </Text>
    </View>
  );
}

export function countGlosses(entry: DictionaryEntry): number {
  return entry.senses.reduce((n, s) => n + s.glosses.length, 0);
}

export function firstGlosses(entry: DictionaryEntry, n: number): string[] {
  const out: string[] = [];
  for (const sense of entry.senses) {
    for (const g of sense.glosses) {
      out.push(g);
      if (out.length >= n) return out;
    }
  }
  return out;
}

/**
 * Thumbs up/down for "was this the right difficulty", on the open Story's footer
 * and on library rows. Both are Lucide, both are at least MIN_TOUCH to hit, and
 * both are disabled while a save is in flight, so two presses can't race for the
 * rating column.
 */
export function RatingButtons({
  view,
  storyId,
  rating,
}: {
  view: StoryView;
  storyId: string;
  rating: StoryRating | null | undefined;
}) {
  const thumb = (value: StoryRating, glyph: "thumbs-up" | "thumbs-down", label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: rating === value, disabled: view.pending }}
      disabled={view.pending}
      onPress={() => void view.rate(storyId, value)}
      className={rating === value ? "border-primary bg-card" : "border-transparent"}
      style={styles.thumb}
    >
      <Icon
        name={glyph}
        size="sm"
        className={rating === value ? "text-primary" : "text-muted-foreground"}
        pointerEvents="none"
      />
    </Pressable>
  );
  return (
    <View style={styles.rating}>
      {thumb("up", "thumbs-up", "Rate up")}
      {thumb("down", "thumbs-down", "Rate down")}
    </View>
  );
}

/** `1–10 of 23` — the library page's position line (same words as the web). */
export function pageSummary(page: { items: unknown[]; total: number; limit: number; offset: number }) {
  return `${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)} of ${page.total}`;
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { fontWeight: "600" },
  underline: { height: 2, marginTop: 2 },
  rating: { flexDirection: "row", gap: 6 },
  thumb: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
