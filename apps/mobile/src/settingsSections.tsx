// Shared chrome for settings screens (issue #50): the small heading and back
// pieces every section route and the setup wizard put around a section's own
// content.

import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

import { Icon } from "./components/ui/icon";

/**
 * What a section's step-save reports to the setup wizard (review S2):
 * "saved" wrote something, "nothing" had no entered input to write,
 * "blocked" tried and failed — the section shows its own error and the
 * wizard stays put.
 */
export type StepSaveOutcome = "saved" | "nothing" | "blocked";

/** The step-save itself: runs the section's save, reports the outcome. */
export type StepSaveFn = () => Promise<StepSaveOutcome>;

/**
 * How a section hands its save to the setup wizard: it calls the registrar
 * with its save while mounted (and with null on unmount), so Next/Finish
 * reuse the section's Save rather than duplicating (or drifting from) it.
 * The wizard keeps whatever was registered in a ref of its own — passing
 * the wizard's ref object down instead would mean the sections mutate a
 * prop, which the react-hooks compiler rules reject. The hub never passes
 * a registrar.
 */
export type StepSaveRegistrar = (save: StepSaveFn | null) => void;

/** Back affordance for the section route. */
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
    // text-foreground is not decoration: without an explicit colour class the
    // heading inherits the test host's default near-black, which disappears
    // on the dark palette (#50 review B1). Colour class last — uniwind drops a
    // colour class that precedes the custom text-size class on native.
    // accessibilityRole="header" is the safe spelling of a heading on both
    // hosts (S7's verified set) — the section name reads as a heading to a
    // screen reader, matching the wizard's step titles (S4).
    <Text
      accessibilityRole="header"
      className="mb-3 text-title-sm font-serif text-foreground"
    >
      {children}
    </Text>
  );
}
