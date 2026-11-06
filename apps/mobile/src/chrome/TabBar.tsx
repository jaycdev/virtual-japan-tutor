import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCSSVariable } from "uniwind";
import { useT } from "@vjt/core";

import { MIN_TOUCH } from "../touch.ts";
import { DESTINATIONS, type Destination } from "./destinations.ts";
import { Labeled, T } from "../components/Text.tsx";

/**
 * Bottom tab bar: five destinations as labelled icons. Rendered as
 * accessibilityRole="tab" so screen readers announce selection; the Shell hides
 * it while a Story reader route is open.
 * Icon strokes take the design tokens resolved at runtime — Uniwind classNames
 * do not reach SVG colour on native, so the icons get the same token-safe
 * route Icon and SwitchRow use (TRIAL_RESULTS §4, via useCSSVariable).
 */
export function TabBar({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (destination: Destination) => void;
}) {
  const accent = useCSSVariable("--color-primary") ?? undefined;
  const subtle = useCSSVariable("--color-muted-foreground") ?? undefined;
  const insets = useSafeAreaInsets();
  const { tp } = useT();
  return (
    <View className="flex-row border-t border-border bg-card" style={{ paddingBottom: insets.bottom }}>
      {DESTINATIONS.map(({ path, labelKey, icon: Icon }) => {
        const selected = path === active;
        // The tab's name is the plain sentence: a label is read out, not drawn,
        // so `ja-furigana` says the word with no readings. The visible caption
        // keeps them (issue #125).
        const label = tp(labelKey);
        return (
          <Pressable
            key={path}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            // role and aria-selected name the same state for hosts that read ARIA
            // props (the test host does); native reads the accessibility* pair.
            role="tab"
            aria-selected={selected}
            onPress={() => onSelect({ path, label, labelKey, icon: Icon })}
            className="flex-1 items-center justify-center gap-1 active:bg-accent"
            style={{ minHeight: MIN_TOUCH }}
          >
            <Icon size={22} color={selected ? accent : subtle} />
            {/* The tab already names itself; the drawn caption stays hidden. */}
            <Labeled>
              <T
                k={labelKey}
                className={
                  selected
                    ? "text-caption font-semibold text-primary"
                    : "text-caption text-muted-foreground"
                }
              />
            </Labeled>
          </Pressable>
        );
      })}
    </View>
  );
}
