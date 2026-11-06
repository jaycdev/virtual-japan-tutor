import type { StoryRating } from "@vjt/api-client";
import { translatePlain, useT, type InterfaceLanguage, type StoryView } from "@vjt/core";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { Icon } from "../components/ui/icon";
import { MIN_TOUCH } from "../touch";
import { T } from "../components/Text.tsx";

/**
 * Small shared pieces of the mobile reader: the JLPT badge, the gloss helpers
 * (same cap rules as the web Lookup row), and the thumbs rating buttons.
 */

/** The MaruMori SRS Level, as small caption text: `SRS 4` (GLOSSARY: SRS Level). */
export function SrsLevelText({ level }: { level: number }) {
  return <T k="reader.srs" params={{ level }} className="text-caption text-muted-foreground" />;
}

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
  const { tp: plain } = useT();
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
      {thumb("up", "thumbs-up", plain("reader.rateUpAria"))}
      {thumb("down", "thumbs-down", plain("reader.rateDownAria"))}
    </View>
  );
}

/** `1–10 of 23` — the library page's position line, in the Learner's language. */
export function pageSummary(
  page: { items: unknown[]; total: number; limit: number; offset: number },
  lang: InterfaceLanguage,
) {
  return translatePlain(lang, "mobile.pageRange", {
    from: page.offset + 1,
    to: Math.min(page.offset + page.items.length, page.total),
    total: page.total,
  });
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
