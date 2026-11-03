import type { DictionaryEntry, StoryRating } from "@vjt/api-client";
import type { StoryView } from "@vjt/core";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "../theme.ts";

/**
 * Small shared pieces of the mobile reader: the JLPT badge, the gloss helpers
 * (same cap rules as the web Lookup row) and the thumbs rating buttons.
 */

export function JlptBadge({ level }: { level: string }) {
  const colors = useColors();
  return (
    <View style={[styles.badge, { borderColor: colors.accent }]}>
      <Text style={{ color: colors.accent, fontSize: 12, fontWeight: "600" }}>{level}</Text>
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

/** 👍/👎 on the open Story or any library row; a rating is replaceable. */
export function RatingButtons({
  view,
  storyId,
  rating,
}: {
  view: StoryView;
  storyId: string;
  rating: StoryRating | null | undefined;
}) {
  const colors = useColors();
  const thumb = (value: StoryRating, glyph: string, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: rating === value, disabled: view.pending }}
      disabled={view.pending}
      onPress={() => void view.rate(storyId, value)}
      style={[styles.thumb, rating === value && { borderColor: colors.accent, backgroundColor: colors.card }]}
    >
      <Text style={{ fontSize: 18 }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={styles.rating}>
      {thumb("up", "👍", "Rate up")}
      {thumb("down", "👎", "Rate down")}
    </View>
  );
}

/** `1–10 of 23` — the library page's position line (same words as the web). */
export function pageSummary(page: { items: unknown[]; total: number; limit: number; offset: number }) {
  return `${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)} of ${page.total}`;
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  rating: { flexDirection: "row", gap: 6 },
  thumb: {
    minWidth: 40,
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
