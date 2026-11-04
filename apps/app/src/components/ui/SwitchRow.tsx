import { Switch } from "react-native";

import { useColors } from "../../theme.ts";
import { Row } from "./Row.tsx";

/**
 * Switch row for immediate on/off settings (translation blur, Boosting,
 * drop a saved key…). The switch itself gets the same accessible label as
 * the row, so screen readers and tests address the control directly. The
 * track/thumb colours come from the JS palette because RN's Switch takes
 * colour values, not classes — the same route the chrome's icons use.
 */
export function SwitchRow({
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
