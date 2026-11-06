import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";

import { useT } from "@vjt/core";
import { Labeled, labelAria } from "../Text.tsx";

/**
 * One line inside a Card (issue #50): label, optional hint underneath,
 * optional trailing control, separator to the next row unless `last`. A row
 * with `onPress` becomes a single 44 px button whose accessible name is the
 * label.
 */
export function Row({
  label,
  hint,
  right,
  onPress,
  last = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const { tp } = useT();
  const inner = (
    <View
      className={`min-h-11 flex-row items-center gap-3 px-4 py-2 ${last ? "" : "border-b border-border"}`}
    >
      <View className="flex-1 gap-0.5">
        {typeof label === "string" ? <Text className="text-body text-foreground">{label}</Text> : label}
        {hint
          ? typeof hint === "string"
            ? <Text className="text-small text-muted-foreground">{hint}</Text>
            : hint
          : null}
      </View>
      {right ? <View className="flex-row items-center gap-2">{right}</View> : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      accessibilityRole="button"
      // Plain strings double as the accessible name, and so do <T> elements
      // — through the plain-Japanese text the entry draws.
      accessibilityLabel={labelAria(label, tp)}
      accessibilityHint={labelAria(hint, tp)}
      onPress={onPress}
      className="active:bg-accent"
    >
      {/* The row's name is the label + hint; the drawn lines stay out of the
          accessibility tree so a Listener hears the row once. */}
      <Labeled>{inner}</Labeled>
    </Pressable>
  );
}
