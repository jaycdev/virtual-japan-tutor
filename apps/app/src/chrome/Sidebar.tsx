import { Pressable, Text, View } from "react-native";
import { useCSSVariable } from "uniwind";

import { MIN_TOUCH } from "../touch.ts";
import { DESTINATIONS, type Destination } from "./destinations.ts";

/**
 * Left sidebar for wide screens (≥1024 px, issue #44): the 読 wordmark, the
 * five destinations, and the signed-in Learner with Log out at the foot.
 * About 240 px (w-60) and never overlapping the content column. Icon strokes
 * get the design tokens through useCSSVariable, as in TabBar (Uniwind
 * classNames do not reach SVG colour on native).
 */
export function Sidebar({
  active,
  username,
  onSelect,
  onLogout,
}: {
  active: string;
  username: string;
  onSelect: (destination: Destination) => void;
  onLogout: () => void;
}) {
  const accent = useCSSVariable("--color-primary") ?? undefined;
  const subtle = useCSSVariable("--color-muted-foreground") ?? undefined;
  return (
    <View className="w-60 justify-between border-r border-border bg-card">
      <View className="gap-6 p-4">
        <View className="flex-row items-baseline gap-2 py-2">
          <Text className="text-display font-serif text-primary" allowFontScaling={false}>
            読
          </Text>
          <Text className="text-small font-semibold text-muted-foreground">Virtual Japan Tutor</Text>
        </View>
        <View className="gap-1">
          {DESTINATIONS.map(({ path, label, icon: Icon }) => {
            const selected = path === active;
            return (
              <Pressable
                key={path}
                accessibilityRole="link"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
                // Raw ARIA props for react-native-web (see TabBar); links
                // mark the current page rather than a selected tab.
                role="link"
                aria-current={selected ? "page" : undefined}
                onPress={() => onSelect({ path, label, icon: Icon })}
                className={`flex-row items-center gap-3 rounded-md px-3 active:bg-accent ${
                  selected ? "bg-accent" : ""
                }`}
                style={{ minHeight: MIN_TOUCH }}
              >
                <Icon size={20} color={selected ? accent : subtle} />
                <Text
                  className={
                    selected
                      ? "text-body font-semibold text-primary"
                      : "text-body text-muted-foreground"
                  }
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      <View className="gap-2 border-t border-border p-4">
        <Text
          className="text-small text-muted-foreground"
          accessibilityLabel={`Signed in as ${username}`}
        >
          {username}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Log out"
          // Raw ARIA role for react-native-web (see the destinations above).
          role="button"
          onPress={onLogout}
          className="min-h-11 flex-row items-center gap-2 rounded-md px-1 active:bg-accent"
        >
          <Text className="text-small text-destructive">Log out</Text>
        </Pressable>
      </View>
    </View>
  );
}
