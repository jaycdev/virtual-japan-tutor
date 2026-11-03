import type { ComponentProps } from "react";
import { Check, ChevronLeft, ChevronRight, CircleCheck, CircleX, ThumbsDown, ThumbsUp, X } from "lucide-react-native";
import { useCSSVariable } from "uniwind";

/**
 * The app's one way to draw an icon, so glyph choice and size live in one file
 * instead of being re-decided per call site. Sizes ride the same type steps as text
 * — none of these are off-scale except `lg`, the tab-bar size the design brief names.
 * Colour comes from a colour class, like everywhere else:
 * `<Icon name="thumbs-up" size="sm" className="text-primary" />`.
 *
 * The colour class alone only paints on web, though: uniwind's transform styles
 * react-native-web components, but a bare lucide glyph on native ignores it, and
 * every Icon rendered colourless on device (#46 review B2). So the component
 * also resolves the token the class names and hands the glyph its `color`
 * directly — the token-safe route the spike verified (TRIAL_RESULTS §4, via
 * useCSSVariable). One component, both hosts, no token literals in call sites.
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
  // Find the colour utility the call site named (`text-success`, `text-primary`…)
  // and resolve the same design token at runtime; every text-* colour in the
  // token sheet is named `--color-<utility>`, so the mapping stays mechanical.
  const tone = /(?:^|\s)text-([a-z-]+)/.exec(props.className ?? "")?.[1];
  const token = useCSSVariable(tone ? `--color-${tone}` : "--color-foreground");
  return <Glyph {...props} color={props.color ?? token ?? undefined} size={SIZES[size]} />;
}
