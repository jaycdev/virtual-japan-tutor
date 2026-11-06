import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";

import { useT } from "@vjt/core";
import { labelAria } from "../Text.tsx";

/**
 * A pill for a single choice among a few values (theme, text size, Starting
 * Level, furigana threshold…), ported onto design tokens in #50. Selected
 * reads as selected by border and fill alone — never colour words the reader
 * cannot see — and the touch target stays 44 px.
 */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: ReactNode;
  selected: boolean;
  onPress: () => void;
}) {
  const { tp } = useT();
  return (
    <Pressable
      accessibilityRole="button"
      // A plain-string label names the chip, and so does a <T> — through the
      // plain text of the entry it draws.
      accessibilityLabel={labelAria(label, tp)}
      accessibilityState={{ selected }}
      // Toggle-button semantics on the web host (see chrome/TabBar.tsx for
      // the raw-ARIA pattern this app uses next to the RN accessibility props).
      aria-pressed={selected}
      onPress={onPress}
      className={`min-h-11 min-w-11 items-center justify-center rounded-full border px-4 active:bg-accent ${
        selected ? "border-primary bg-secondary" : "border-border bg-card"
      }`}
    >
      {/* uniwind drops a colour class that precedes a text-size class on native,
          so the size comes first here as everywhere else. */}
      {typeof label === "string" ? (
        <Text className={`text-body ${selected ? "font-semibold text-primary" : "text-foreground"}`}>
          {label}
        </Text>
      ) : (
        // A <T> pill (issue #125) styles its own text, colour and weight included.
        label
      )}
    </Pressable>
  );
}

/** Wrapping row of Chips. */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View className="flex-row flex-wrap gap-2">{children}</View>;
}
