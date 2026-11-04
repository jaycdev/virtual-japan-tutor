import { Switch } from "react-native";
import { useCSSVariable } from "uniwind";

import { Row } from "./Row.tsx";

/**
 * Switch row for immediate on/off settings (translation blur, Boosting,
 * drop a saved key…). The switch itself gets the same accessible label as
 * the row, so screen readers and tests address the control directly.
 *
 * RN's Switch takes colour VALUES, not classes, so the colours come from
 * the design tokens resolved at runtime through useCSSVariable — the same
 * token-safe route Icon uses (TRIAL_RESULTS §4). The earlier version read
 * the legacy JS palette bridge (theme.ts, since deleted in #51) followed
 * the SYSTEM colour scheme rather than the app's Uniwind theme (wrong on
 * forced-Dark over a light OS), and its off-track sat at 1.43:1 / 1.33:1 —
 * under plan §6's 3:1 for UI components. The tokens:
 * off-track --color-muted-foreground
 * (5.67:1 light, 6.24:1 dark against the card), on-track --color-primary
 * (8.54:1 / 6.94:1), thumb --color-card (5.67:1 / 6.24:1 off,
 * 8.54:1 / 6.94:1 on). Every pair clears 3:1 in both palettes.
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
  const trackOff = useCSSVariable("--color-muted-foreground") ?? undefined;
  const trackOn = useCSSVariable("--color-primary") ?? undefined;
  const thumb = useCSSVariable("--color-card") ?? undefined;
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
          trackColor={{ false: trackOff, true: trackOn }}
          thumbColor={thumb}
        />
      }
    />
  );
}
