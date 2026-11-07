// Shared chrome for settings screens (issue #50): the small heading and back
// pieces every section route and the setup wizard put around a section's own
// content.

import type { ReactNode } from "react";
import { Pressable, Text } from "react-native";

import { useJapaneseFont } from "./japaneseFont/index.tsx";
import { Icon } from "./components/ui/icon";

// The setup wizard's save contract lives in @vjt/core, shared with the web app.
export type { StepSaveFn, StepSaveOutcome, StepSaveRegistrar } from "@vjt/core";

/** Back affordance for the section route. */
export function SectionBack({ label, onPress }: { label: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      // A plain string names the button; a <T> is its own labelled element.
      accessibilityLabel={typeof label === "string" ? label : undefined}
      onPress={onPress}
      className="mb-3 min-h-11 flex-row items-center gap-1 self-start rounded-md px-2 active:bg-accent"
    >
      <Icon name="chevron-left" size="sm" />
      {typeof label === "string" ? <Text className="text-body text-foreground">{label}</Text> : label}
    </Pressable>
  );
}

/** The section's name above its content. */
export function SectionHeading({ children }: { children: ReactNode }) {
  const jp = useJapaneseFont();
  // A string gets this component's Text; a <T> (issue #125) brings its own
  // line, header role and classes — including the Japanese font class.
  if (typeof children !== "string") return <>{children}</>;
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
      className={`mb-3 text-title-sm ${jp.regular} text-foreground`}
    >
      {children}
    </Text>
  );
}
