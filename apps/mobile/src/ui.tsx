import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MIN_TOUCH, useColors } from "./theme.ts";

/**
 * The small shared kit every mobile screen uses. Native-feeling by construction:
 * grouped cards with separators, ≥44dp touch targets, semantic colors that follow
 * the system light/dark setting, and safe-area padding. Built from core
 * react-native components so the jsdom/react-native-web test harness can drive
 * them (accessible roles and names come from the accessibility* props).
 */

/** Full-bleed background + top safe-area padding; screens fill in below it. */
export function Screen({ children }: { children: ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        paddingTop: insets.top,
      }}
    >
      <View style={styles.screenInner}>{children}</View>
    </View>
  );
}

/** Scrollable body with the usual gutters and bottom safe-area padding. */
export function Scroll({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.scrollInner}>{children}</View>
    </ScrollView>
  );
}

/** Bottom safe-area space for non-scrolling screens (list + footer buttons). */
export function BottomSpace() {
  const insets = useSafeAreaInsets();
  return <View style={{ height: insets.bottom }} />;
}

/** Large screen title, optionally with a Back affordance (no hardware back). */
export function Title({ text, onBack }: { text: string; onBack?: () => void }) {
  const colors = useColors();
  return (
    <View style={styles.titleRow}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          onPress={onBack}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <Text style={{ color: colors.accent, fontSize: 16 }}>‹ Back</Text>
        </Pressable>
      ) : null}
      <Text style={[styles.title, { color: colors.label }]} accessibilityRole="header">
        {text}
      </Text>
    </View>
  );
}

export function SectionTitle({ text }: { text: string }) {
  const colors = useColors();
  return <Text style={[styles.sectionTitle, { color: colors.subtle }]}>{text}</Text>;
}

export function Muted({ text }: { text: string }) {
  const colors = useColors();
  return <Text style={[styles.body, { color: colors.subtle }]}>{text}</Text>;
}

export function Body({ text }: { text: string }) {
  const colors = useColors();
  return <Text style={[styles.body, { color: colors.label }]}>{text}</Text>;
}

/** A failure the Learner should see (role alert via accessibilityRole). */
export function ErrorText({ text }: { text: string }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="alert" style={[styles.body, { color: colors.danger }]}>
      {text}
    </Text>
  );
}

/** A settled outcome worth confirming (Correct, Saved…). */
export function StatusText({ text, ok = true }: { text: string; ok?: boolean }) {
  const colors = useColors();
  return (
    <Text accessibilityRole="status" style={[styles.body, { color: ok ? colors.success : colors.danger }]}>
      {text}
    </Text>
  );
}

/** Filled accent button — the primary action on a screen. */
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: colors.accent, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      <Text style={{ color: colors.onAccent, fontSize: 16, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** Quiet text button for secondary actions (Retry, Cancel, Keep…). */
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
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.linkButton,
        pressed && styles.pressed,
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={{ color: danger ? colors.danger : colors.accent, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

/** Labelled text input; the label doubles as the accessibility label. */
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
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
  secure?: boolean;
  placeholder?: string;
  keyboardType?: "default" | "number-pad" | "url" | "email-address";
  maxLength?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.subtle }]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={[
          styles.input,
          { backgroundColor: colors.field, borderColor: colors.separator, color: colors.label },
          disabled && { opacity: 0.5 },
        ]}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        secureTextEntry={secure}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        keyboardType={keyboardType}
        maxLength={maxLength}
        editable={!disabled}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType={onSubmit ? "done" : undefined}
      />
    </View>
  );
}

/** Grouped card; rows inside get separators through the Row component. */
export function Card({ children }: { children: ReactNode }) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.separator }]}>
      {children}
    </View>
  );
}

/** One line in a Card. Tappable rows get button semantics; `last` drops the separator. */
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
  const colors = useColors();
  const inner = (
    <View style={[styles.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.separator }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: colors.label }]}>{label}</Text>
        {hint ? <Text style={[styles.rowHint, { color: colors.subtle }]}>{hint}</Text> : null}
      </View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </View>
  );
  if (!onPress) return inner;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => pressed && styles.pressed}
    >
      {inner}
    </Pressable>
  );
}

/** Switch row for immediate on/off settings (Boosting, blur…). */
export function ToggleRow({
  label,
  hint,
  value,
  onToggle,
  disabled = false,
  last = false,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const colors = useColors();
  return (
    <Row
      label={label}
      hint={hint}
      last={last}
      right={
        <Switch
          accessibilityLabel={label}
          value={value}
          disabled={disabled}
          onValueChange={onToggle}
          trackColor={{ false: colors.separator, true: colors.accent }}
          thumbColor={colors.onAccent}
        />
      }
    />
  );
}

/** Small pill for a single choice among a few values (furigana 1–9). */
export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderColor: selected ? colors.accent : colors.separator,
          backgroundColor: selected ? colors.accent : colors.card,
        },
        pressed && styles.pressed,
      ]}
    >
      <Text style={{ color: selected ? colors.onAccent : colors.label, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

/** Row of wrapping chips (kept simple: one flex row per group). */
export function ChipRow({ children }: { children: ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

const styles = StyleSheet.create({
  screenInner: { flex: 1 },
  fill: { flex: 1 },
  scrollInner: { padding: 16, gap: 16 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TOUCH },
  backButton: { paddingHorizontal: 4, paddingVertical: 8 },
  title: { fontSize: 26, fontWeight: "700", flexShrink: 1 },
  sectionTitle: { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  body: { fontSize: 15, lineHeight: 21 },
  primaryButton: {
    minHeight: MIN_TOUCH,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  linkButton: { minHeight: 32, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  pressed: { opacity: 0.7 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "500" },
  input: {
    minHeight: MIN_TOUCH,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  card: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: MIN_TOUCH,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 16 },
  rowHint: { fontSize: 13 },
  rowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  chip: {
    minHeight: MIN_TOUCH,
    minWidth: 44,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
