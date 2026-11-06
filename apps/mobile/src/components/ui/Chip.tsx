import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";

import { useT } from "@vjt/core";
import { Labeled, labelAria } from "../Text.tsx";

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
        // A <T> pill (issue #125) styles its own text, colour and weight
        // included. The chip already speaks this sentence as its name, so the
        // drawn line stays out of the accessibility tree.
        <Labeled>{label}</Labeled>
      )}
    </Pressable>
  );
}

/** Wrapping row of Chips. The optional label names the row for assistive tech
 *  where a visible legend would be redundant (the Interface Language chips). */
export function ChipRow({
  children,
  testID,
  accessibilityLabel,
}: {
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View testID={testID} accessibilityLabel={accessibilityLabel} className="flex-row flex-wrap gap-2">
      {children}
    </View>
  );
}
