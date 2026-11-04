import { Pressable, Text } from "react-native";

/**
 * Quiet text button for secondary actions (Retry, Cancel, Keep, Remove key…),
 * on design tokens (#50). Always 44 px tall even though the glyph is a line
 * of text — the touch target rule has no exceptions.
 */
export function LinkButton({
  label,
  onPress,
  disabled = false,
  danger = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      // P3: no horizontal padding — a quiet button under a row label or a
      // heading must sit on the same left edge as the text it follows; the
      // 8 px inset used to leave it hanging in from everything above it.
      className="min-h-11 self-start justify-center rounded-md active:bg-accent"
    >
      {/* uniwind drops a colour class that precedes a text-size class on native,
          so the size comes first here as everywhere else. */}
      <Text className={`text-body ${danger ? "text-destructive" : "text-primary"}`}>{label}</Text>
    </Pressable>
  );
}
