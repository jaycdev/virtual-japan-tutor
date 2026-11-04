import { Text, TextInput, View } from "react-native";
import { useCSSVariable } from "uniwind";

/**
 * Labelled text input with the Settings/Login input shape (issue #50): the
 * label sits above and doubles as the accessibility label, the box is a 44 px
 * token-bordered field. `secure` masks the value (API keys) — the typed text
 * is never rendered as a Text node anywhere, so the screen never echoes a
 * secret back.
 */
export function Field({
  label,
  value,
  onChangeText,
  onSubmit,
  secure = false,
  placeholder,
  keyboardType,
  maxLength,
  disabled = false,
  testID,
  onFocus,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
  /** Mask the entry (API keys and the like). */
  secure?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "number-pad" | "url" | "email-address";
  maxLength?: number;
  disabled?: boolean;
  testID?: string;
  onFocus?: () => void;
}) {
  // Placeholders read as muted, not as entered text (review B3). RN takes a
  // colour value, not a class, so the token is resolved through the same
  // useCSSVariable route as the icons — 5.39:1 light / 6.78:1 dark against
  // the field's background, and it follows the app's Uniwind theme rather
  // than the OS colour scheme.
  const placeholderColor = useCSSVariable("--color-muted-foreground") ?? undefined;
  return (
    <View className="gap-1.5">
      <Text className="text-small text-muted-foreground">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        className="min-h-11 rounded-lg border border-input bg-background px-3 text-body text-foreground"
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        onFocus={onFocus}
        secureTextEntry={secure}
        placeholder={placeholder}
        placeholderTextColor={placeholderColor}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={!disabled}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType={onSubmit ? "done" : undefined}
      />
    </View>
  );
}
