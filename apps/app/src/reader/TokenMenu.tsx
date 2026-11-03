import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MeasurableNode, MenuOption, MenuOptionId, Rect } from "./holdMenu.ts";

/**
 * The Lookup menu (issues #14, #45): it opens once the Learner keeps holding
 * a token (or right-clicks one on web), sits at the token, and the release on
 * one of its options is the choice — on web, so is a plain click on the row
 * (`onSelect`), since a mouse release never travels through the hold gesture.
 * Rows carry testID `menu-option-<id>` (and the card `token-menu`) so the
 * release hit-test can measure them; StoryReader injects the measuring
 * function because the test host reports no geometry.
 */
export function TokenMenu({
  options,
  x,
  y,
  screenWidth,
  screenHeight,
  measure,
  onRects,
  onSelect,
}: {
  options: MenuOption[];
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
  measure: (testID: string, node: MeasurableNode | null) => Rect | null;
  /** Reports the option rectangles (plus the card) once they are known. */
  onRects: (rects: Map<string, Rect>) => void;
  /** A click/tap on an option row (the web path; mobile picks on release). */
  onSelect: (option: MenuOptionId) => void;
}) {
  const cardRef = useRef<MeasurableNode | null>(null);
  const optionRefs = useRef(new Map<MenuOptionId, MeasurableNode>());

  useEffect(() => {
    const rects = new Map<string, Rect>();
    let complete = true;
    const card = measure("token-menu", cardRef.current);
    if (card) rects.set("token-menu", card);
    for (const option of options) {
      const rect = measure(`menu-option-${option.id}`, optionRefs.current.get(option.id) ?? null);
      if (!rect) complete = false;
      else rects.set(`menu-option-${option.id}`, rect);
    }
    if (complete && rects.has("token-menu")) onRects(rects);
  }, [options, measure, onRects]);

  // Keep the card fully on screen: anchored at the token, flipped above the
  // press point when the press sits in the bottom quarter.
  const menuWidth = Math.min(280, screenWidth - 24);
  const left = Math.min(Math.max(12, x - menuWidth / 2), screenWidth - menuWidth - 12);
  const flipUp = y > screenHeight * 0.7;
  const top = flipUp ? Math.max(12, y - 220) : y + 12;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { left, top, width: menuWidth }]}
      accessibilityLabel="Lookup menu"
    >
      <View
        ref={(node) => {
          cardRef.current = node;
        }}
        className="bg-card border-border shadow-md"
        style={styles.card}
      >
        {options.map((option) => (
          <Pressable
            key={option.id}
            testID={`menu-option-${option.id}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !option.enabled }}
            disabled={!option.enabled}
            onPress={() => onSelect(option.id)}
            ref={(node) => {
              if (node) optionRefs.current.set(option.id, node);
              else optionRefs.current.delete(option.id);
            }}
            style={styles.option}
          >
            {/* Labels read dimmed when disabled; the release never picks a
                disabled option (see optionAt). */}
            <Text className={option.enabled ? "text-foreground" : "text-muted-foreground"} style={{ fontSize: 16 }}>
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: "absolute", zIndex: 20 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    // A shadow reads as a floating card over the story text (elevation is
    // the Android half; web gets it from the Uniwind shadow class).
    elevation: 6,
  },
  option: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
});
