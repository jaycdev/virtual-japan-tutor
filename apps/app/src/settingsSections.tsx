// Shared chrome for settings screens (issue #50): the wide/narrow decision
// and the small heading/back pieces every section route and the setup wizard
// put around a section's own content.

import type { ReactNode } from "react";
import { Pressable, Text, useWindowDimensions } from "react-native";

import { Icon } from "./components/ui/icon";
import { SIDEBAR_BREAKPOINT } from "./chrome/Shell";

/**
 * True at/above the width where the app chrome already shows a sidebar —
 * the same 1024 px line `Shell` uses (issue #44), so the hub goes two-pane
 * exactly when the screen has room for a second column. A hook because it
 * tracks window resizes.
 */
export function useWideLayout(): boolean {
  return useWindowDimensions().width >= SIDEBAR_BREAKPOINT;
}

/** Back affordance for the narrow section routes. */
export function SectionBack({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="mb-3 min-h-11 flex-row items-center gap-1 self-start rounded-md px-2 active:bg-accent"
    >
      <Icon name="chevron-left" size="sm" />
      <Text className="text-body text-foreground">{label}</Text>
    </Pressable>
  );
}

/** The section's name above its content. */
export function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-3 text-title-sm font-serif">{children}</Text>
  );
}
