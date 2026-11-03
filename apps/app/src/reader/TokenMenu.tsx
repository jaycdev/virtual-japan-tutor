import { type ComponentRef, type RefObject, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

import * as DialogPrimitive from "@rn-primitives/dialog";

import { Popover } from "../rnr/popover.tsx";
import type { MeasurableNode, MenuOption, MenuOptionId, Rect } from "./holdMenu.ts";

/**
 * The Lookup menu (issues #14, #45): it opens once the Learner keeps holding
 * a token (or right-clicks one on web), sits at the token, and the release on
 * one of its options is the choice — on web, so is a plain click on the row
 * (`onSelect`), since a mouse release never travels through the hold gesture.
 * The surface carries testID `token-menu` and the rows `menu-option-<id>` so
 * the release hit-test can measure them; StoryReader injects the measuring
 * function because the test host reports no geometry.
 *
 * The viewport width decides the FORM it is rendered in (review on #45):
 * - wide (at/above the shell's OVERLAY_BREAKPOINT): RN Primitives' Popover,
 *   anchored to the token by the primitives, dismissed by tap-outside and Escape
 * - narrow: the same rows in RN Primitives' Dialog, pinned to the bottom edge
 *   as a sheet
 *
 * Either way the dismissal — tap outside, Escape, Android Back — arrives at
 * `onDismiss`, so the hold machine and the overlay never disagree.
 */
export function TokenMenu({
  options,
  x,
  y,
  narrow,
  screenWidth,
  screenHeight,
  measure,
  onRects,
  onSelect,
  onDismiss,
  focusReturnTestId,
  pointerHeld,
}: {
  options: MenuOption[];
  x: number;
  y: number;
  /** Below the shell's OVERLAY_BREAKPOINT the menu is a bottom sheet. */
  narrow: boolean;
  screenWidth: number;
  screenHeight: number;
  measure: (testID: string, node: MeasurableNode | null) => Rect | null;
  /** Reports the option rectangles (plus the card) once they are known. */
  onRects: (rects: Map<string, Rect>) => void;
  /** A click/tap on an option row (the web path; mobile picks on release). */
  onSelect: (option: MenuOptionId) => void;
  /** The overlay wants to close: tap outside, Escape, or Back. */
  onDismiss: () => void;
  /** Web: the testID of the token the menu belongs to; focus returns to it. */
  focusReturnTestId?: string | null;
  /** Whether a finger or mouse button is still down on the story text. */
  pointerHeld: RefObject<boolean>;
}) {
  const cardRef = useRef<MeasurableNode | null>(null);
  // The invisible anchor the wide popover is placed against. RN Primitives
  // augments the trigger node with open()/close(), which is how a token press
  // opens it: the trigger is never clicked.
  const triggerRef = useRef<ComponentRef<typeof Popover.Trigger> | null>(null);
  const optionRefs = useRef(new Map<MenuOptionId, MeasurableNode>());
  // The native Popover portals its content only once the trigger has been
  // measured, so the surface can appear after this component first renders;
  // each layout pass re-runs the measuring.
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

  useEffect(() => {
    // RN Primitives augments the mounted trigger node with open(); the hold
    // (or web right-click) has already decided the menu is open, so ask the
    // anchored overlay to open with it.
    triggerRef.current?.open();
  }, []);

  const surfaceProps = {
    ref: (node: MeasurableNode | null) => {
      cardRef.current = node;
    },
    onLayout: () => setLayoutTick((tick) => tick + 1),
    testID: "token-menu",
  };

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
      <Text
        className={option.enabled ? "text-body text-foreground" : "text-body text-muted-foreground"}
      >
        {option.label}
      </Text>
    </Pressable>
  ));

  if (narrow) {
    return (
      <DialogPrimitive.Root open onOpenChange={(open) => !open && onDismiss()}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay style={styles.backdrop} className="bg-backdrop" />
          <DialogPrimitive.Content
            {...surfaceProps}
            className="bg-card border-t border-border"
            style={StyleSheet.flatten([styles.sheet, { maxWidth: screenWidth - 24 }])}
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

  const surface = (
    <Popover.Content
      {...surfaceProps}
      accessibilityLabel="Lookup menu"
      // Both flip to the other side when the token sits in the lower half of
      // the screen. Web places with Radix's own props; the native primitives
      // read `sidePlacement`, and either prop on the other platform is noise.
      {...(Platform.OS === "web"
        ? {
            side: y < screenHeight / 2 ? ("bottom" as const) : ("top" as const),
            // The menu unmounts with the gesture, so Radix's own focus-back
            // (to the trigger) lands nowhere; hand focus to the token itself.
            // One task late — focusing inside Radix's own close handler gets
            // undone by the unmount that follows — and never mid-press: moving
            // focus during a live RN Web press corrupts the responder system
            // for the next one, and a Learner who closes with Escape has
            // already lifted the mouse.
            onCloseAutoFocus: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              const testId = focusReturnTestId;
              if (!testId) return;
              setTimeout(() => {
                if (pointerHeld.current) return;
                const el = document.querySelector(`[data-testid=${JSON.stringify(testId)}]`);
                if (el instanceof HTMLElement) {
                  el.tabIndex = -1;
                  el.focus();
                }
              }, 0);
            },
          }
        : { sidePlacement: y < screenHeight / 2 ? (["bottom"] as const) : (["top"] as const) })}
      align="center"
      sideOffset={12}
      className="bg-card border-border shadow-md"
      style={styles.card}
    >
      {rows}
    </Popover.Content>
  );

  return (
    <Popover.Root
      onOpenChange={(open) => !open && onDismiss()}
      // The primitives' Root renders a real View — give it the geometry the
      // anchor expects. Without it the View sits in flow at the bottom of the
      // column and the anchor's viewport coordinates land in the wrong
      // containing block (the card opens off-screen). box-none keeps it from
      // swallowing the tap-outside the dismissal is watching for.
      style={
        Platform.OS === "web"
          ? // RN's type map has no `fixed`, but RN Web honours it — and only it
            // keeps the anchor's containing block at the viewport origin.
            ({ ...hostFixedWeb, width: screenWidth, height: screenHeight } as ViewStyle)
          : styles.hostFull
      }
      pointerEvents="box-none"
    >
      {/* The anchor, not a control: it is invisible, it is never clicked, and
          the primitives place the card against it and hand focus back to it on
          close. The labelled surface is the menu itself, below. */}
      <Popover.Trigger ref={triggerRef} style={StyleSheet.flatten([styles.anchor, { left: x, top: Math.max(0, y - 8) }])} />
      <Popover.Portal>
        {/* Native needs a layer to swallow a tap outside the menu; web
            dismisses through the primitives' own outside-pointer handling, and
            Radix's portal slots onto a single child, so the overlay is not
            rendered there at all. */}
        {Platform.OS === "web" ? surface : (
          <>
            <Popover.Overlay style={styles.touchCatcher} />
            {surface}
          </>
        )}
      </Popover.Portal>
    </Popover.Root>
  );
}

// Web only: the viewport-covering host for the anchor. `position: fixed` is
// outside RN's type map (StyleSheet.create would reject it), but RN Web
// honours it, and only it keeps the anchor's containing block at (0,0).
const hostFixedWeb = { left: 0, position: "fixed", top: 0, zIndex: 20 };

const styles = StyleSheet.create({
  anchor: {
    height: 1,
    opacity: 0,
    padding: 0,
    position: "absolute",
    width: 1,
    zIndex: 19,
  },
  // The invisible container the anchor is placed inside: it covers the whole
  // viewport, so the anchor's coordinates are viewport coordinates on web
  // (fixed) and reader-view coordinates on native (the reader fills the screen).
  hostFull: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 20 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 4,
    minWidth: 200,
    // A shadow reads as a floating card over the story text (elevation is
    // the Android half; web gets it from the Uniwind shadow class).
    elevation: 6,
  },
  option: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  srOnly: { left: -9999, opacity: 0, position: "absolute" },
  backdrop: { position: "absolute" },
  // Native: the open menu still needs something to swallow a tap outside it.
  touchCatcher: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
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
