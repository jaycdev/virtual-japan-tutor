import { Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";

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
  label: string;
  hint?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const inner = (
    <View
      className={`min-h-11 flex-row items-center gap-3 px-4 py-2 ${last ? "" : "border-b border-border"}`}
    >
      <View className="flex-1 gap-0.5">
        <Text className="text-body text-foreground">{label}</Text>
        {hint ? <Text className="text-small text-muted-foreground">{hint}</Text> : null}
      </View>
      {right ? <View className="flex-row items-center gap-2">{right}</View> : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      className="active:bg-accent"
    >
      {inner}
    </Pressable>
  );
}
