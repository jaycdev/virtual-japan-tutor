import { useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MIN_TOUCH, useColors } from "../theme.ts";
import type { MeasurableNode, MenuOption, MenuOptionId, Rect } from "./holdMenu.ts";

/**
 * The Lookup menu (issue #14): it opens once the Learner keeps holding a
 * token, sits at the token, and the release on one of its options is the
 * choice. Rows carry testID `menu-option-<id>` (and the card `token-menu`)
 * so the release hit-test can measure them; StoryReader injects the
 * measuring function because the test host reports no geometry.
 */
export function TokenMenu({
  options,
  x,
  y,
  screenWidth,
  screenHeight,
  measure,
  onRects,
}: {
  options: MenuOption[];
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
  measure: (testID: string, node: MeasurableNode | null) => Rect | null;
  /** Reports the option rectangles (plus the card) once they are known. */
  onRects: (rects: Map<string, Rect>) => void;
}) {
  const colors = useColors();
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
        style={[styles.card, { backgroundColor: colors.card, borderColor: colors.separator }]}
      >
        {options.map((option) => (
          <Pressable
            key={option.id}
            testID={`menu-option-${option.id}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: !option.enabled }}
            ref={(node) => {
              if (node) optionRefs.current.set(option.id, node);
              else optionRefs.current.delete(option.id);
            }}
            style={styles.option}
          >
            {/* Labels read dimmed when disabled; the release never picks a
                disabled option (see optionAt). */}
            <Text
              style={{
                fontSize: 16,
                color: option.enabled ? colors.label : colors.subtle,
              }}
            >
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
    // A shadow reads as a floating card over the story text.
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  option: { minHeight: MIN_TOUCH, justifyContent: "center", paddingHorizontal: 16 },
});
