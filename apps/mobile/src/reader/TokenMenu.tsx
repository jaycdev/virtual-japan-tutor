import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import * as DialogPrimitive from "@rn-primitives/dialog";
import { useSheetBottomInset } from "../components/ui/sheet.ts";

import type { MeasurableNode, MenuOption, MenuOptionId, Rect } from "@vjt/core";

/**
 * The Lookup menu (issues #14, #45): it opens once the Learner keeps holding a
 * token, and the release on one of its options is the choice. A tap on an
 * option row (`onSelect`) picks it too. The surface carries testID `token-menu`
 * and the rows `menu-option-<id>` so the release hit-test can measure them;
 * StoryReader injects the measuring function because the test host reports no
 * geometry.
 *
 * The menu is always a bottom sheet on the phone: the same rows in RN
 * Primitives' Dialog, pinned to the bottom edge. Dismissal — tap outside, and
 * Android Back — arrives at `onDismiss`, so the hold machine and the overlay
 * never disagree.
 */
export function TokenMenu({
  options,
  measure,
  onRects,
  onSelect,
  onDismiss,
}: {
  options: MenuOption[];
  measure: (testID: string, node: MeasurableNode | null) => Rect | null;
  /** Reports the option rectangles (plus the card) once they are known. */
  onRects: (rects: Map<string, Rect>) => void;
  /** A tap on an option row (the release on a row is picked by the gesture). */
  onSelect: (option: MenuOptionId) => void;
  /** The overlay wants to close: tap outside, or Back. */
  onDismiss: () => void;
}) {
  const inset = useSheetBottomInset();
  const cardRef = useRef<MeasurableNode | null>(null);
  const optionRefs = useRef(new Map<MenuOptionId, MeasurableNode>());
  // The sheet's layout can land after this component first renders; each
  // layout pass re-runs the measuring.
  const [layoutTick, setLayoutTick] = useState(0);

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
  }, [options, measure, onRects, layoutTick]);

  const rows = options.map((option) => (
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
      {/* Labels read dimmed when disabled; the release never picks a disabled
          option (see optionAt). The size class comes first: uniwind drops a
          colour class that precedes a custom text size on native. */}
      <Text className={option.enabled ? "text-body text-foreground" : "text-body text-muted-foreground"}>
        {option.label}
      </Text>
    </Pressable>
  ));

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onDismiss()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay style={styles.backdrop} className="bg-backdrop" />
        <DialogPrimitive.Content
          ref={(node: MeasurableNode | null) => {
            cardRef.current = node;
          }}
          onLayout={() => setLayoutTick((tick) => tick + 1)}
          testID="token-menu"
          className="bg-card border-t border-border"
          style={StyleSheet.flatten([styles.sheet, { paddingBottom: 8 + inset }])}
        >
          {/* The menu is labelled by its options; the dialog still wants a
              title for screen readers, so it gets one nobody sees. */}
          <DialogPrimitive.Title style={styles.srOnly}>Lookup menu</DialogPrimitive.Title>
          {rows}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const styles = StyleSheet.create({
  option: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  srOnly: { left: -9999, opacity: 0, position: "absolute" },
  backdrop: { position: "absolute" },
  sheet: {
    bottom: 0,
    left: 0,
    right: 0,
    position: "absolute",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingVertical: 8,
    elevation: 12,
  },
});
