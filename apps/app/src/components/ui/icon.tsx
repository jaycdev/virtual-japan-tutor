import type { ComponentProps } from "react";
import { Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, ThumbsDown, ThumbsUp, X } from "lucide-react-native";

/**
 * The app's one way to draw an icon, so glyph choice and size live in one file
 * instead of being re-decided per call site. Sizes ride the same type steps as text
 * — none of these are off-scale except `lg`, the tab-bar size the design brief names.
 * Colour comes from a colour class, like everywhere else:
 * `<Icon name="thumbs-up" size="sm" className="text-primary" />`.
 */
const GLYPHS = {
  check: Check,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "circle-check": CircleCheck,
  "circle-x": CircleX,
  "thumbs-down": ThumbsDown,
  "thumbs-up": ThumbsUp,
  close: X,
} as const;

export type IconName = keyof typeof GLYPHS;

const SIZES = { xs: 14, sm: 16, md: 20, lg: 24 } as const;

export type IconSize = keyof typeof SIZES;

type IconProps = ComponentProps<typeof GLYPHS["close"]> & {
  name: IconName;
  /** Defaults to `md` (20); `sm` (16) sits next to body text. */
  size?: IconSize;
};

export function Icon({ name, size = "md", ...props }: IconProps) {
  const Glyph = GLYPHS[name];
  return <Glyph {...props} size={SIZES[size]} />;
}
