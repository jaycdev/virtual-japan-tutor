import * as PopoverPrimitive from "@rn-primitives/popover";
import * as React from "react";
import { Platform } from "react-native";

/**
 * The reader's Popover, aliased from one import path (src/rnr) so every use
 * goes through the same file on every platform.
 *
 * It is the stock RN Primitives compound with one deliberate deviation, and
 * that deviation is web-only. Radix runs its popover modal, and a modal Radix
 * popover sets `pointer-events: none` on `<body>` for as long as it is open.
 * The Lookup menu opens at the end of a hold that started on a story token —
 * with the body disabled the browser can no longer deliver the mouseup to the
 * token, so the hold-and-release and the slide-and-release both die. The
 * primitives' web Root hard-codes Radix's modal mode and exposes no `modal`
 * prop, so while the menu is open this wrapper puts the body's pointer events
 * back, which is what `modal={false}` would have done, and lets Radix tidy the
 * rest up on close.
 *
 * On Android the open menu renders into a Portal with its own Overlay, tap
 * outside closes through that, and body pointer-events means nothing — hence
 * the guard.
 */
function Root({ onOpenChange, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const [open, setOpen] = React.useState(false);
  const handleOpenChange = React.useCallback(
    (value: boolean) => {
      setOpen(value);
      onOpenChange?.(value);
    },
    [onOpenChange],
  );

  React.useEffect(() => {
    if (Platform.OS !== "web" || !open) return;
    // Children flush before this effect, so this runs after Radix's own lock.
    document.body.style.pointerEvents = "auto";
    return () => {
      document.body.style.pointerEvents = "";
    };
  }, [open]);

  return <PopoverPrimitive.Root {...props} onOpenChange={handleOpenChange} />;
}

export const Popover = { ...PopoverPrimitive, Root };
