// The single design source for the web and mobile apps (ADR-0010, plan 2.2-2.5).
// Every value here is transcribed from docs/design/ui-plan.md. `generate`
// (scripts/generate.ts) turns this file into web.css and native.css, and the
// apps import those files instead of hand-writing values. Hex colours are
// allowed in this package only (vjt/no-hardcoded-color, eslint.config.mjs).

/** Colour roles shared by both themes. Every key must exist in light and dark. */
export type ColorToken =
  // Standard colours (plan 2.2, first table)
  | "background"
  | "foreground"
  | "card"
  | "card-foreground"
  | "popover"
  | "popover-foreground"
  | "primary"
  | "primary-foreground"
  | "secondary"
  | "secondary-foreground"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "destructive"
  | "destructive-foreground"
  | "border"
  | "input"
  | "ring"
  // Reader and app colours (plan 2.2, second table)
  | "focus"
  | "grammar"
  | "grammar-focus"
  | "lookup-mark"
  | "furigana"
  | "pitch"
  | "success"
  | "selected-sentence"
  | "backdrop";

export type Palette = Record<ColorToken, string>;

export type Theme = "light" | "dark";

export const palette: Record<Theme, Palette> = {
  light: {
    background: "#faf7f0",
    foreground: "#1f1d1a",
    card: "#fffdf8",
    "card-foreground": "#1f1d1a",
    popover: "#fffdf8",
    "popover-foreground": "#1f1d1a",
    primary: "#2f4b7c",
    "primary-foreground": "#faf7f0",
    secondary: "#efeae0",
    "secondary-foreground": "#1f1d1a",
    muted: "#efeae0",
    "muted-foreground": "#6b655c",
    accent: "#e6ecf5",
    "accent-foreground": "#1f1d1a",
    destructive: "#a3312a",
    "destructive-foreground": "#faf7f0",
    border: "#e2dcd0",
    input: "#e2dcd0",
    ring: "#2f4b7c",
    focus: "#b5452f",
    grammar: "#f3e7b3",
    "grammar-focus": "#ebcf7a",
    "lookup-mark": "#8a8378",
    furigana: "#6b655c",
    pitch: "#2f4b7c",
    success: "#3f6b45",
    "selected-sentence": "#e6ecf5",
    // Ink at 40%, behind sheets and dialogs.
    backdrop: "rgba(31, 29, 26, 0.4)",
  },
  dark: {
    background: "#15161a",
    foreground: "#e9e5db",
    card: "#1d1e23",
    "card-foreground": "#e9e5db",
    popover: "#1d1e23",
    "popover-foreground": "#e9e5db",
    primary: "#8fa8d8",
    "primary-foreground": "#15161a",
    secondary: "#26272d",
    "secondary-foreground": "#e9e5db",
    muted: "#26272d",
    "muted-foreground": "#a39e94",
    accent: "#2a3346",
    "accent-foreground": "#e9e5db",
    destructive: "#e5736a",
    "destructive-foreground": "#15161a",
    border: "#33343a",
    input: "#33343a",
    ring: "#8fa8d8",
    focus: "#e07a5f",
    grammar: "#3a3622",
    "grammar-focus": "#5a4e26",
    "lookup-mark": "#7e796f",
    furigana: "#a39e94",
    pitch: "#8fa8d8",
    success: "#86b98c",
    "selected-sentence": "#232c3d",
    // Black at 60%, behind sheets and dialogs.
    backdrop: "rgba(0, 0, 0, 0.6)",
  },
};

/** Font families, by the bundled file base names that expo-font and the web @font-face blocks register (plan 2.4, ADR-0009). */
export const fonts = {
  sans: "NotoSansJP400",
  sansBold: "NotoSansJP700",
  serif: "NotoSerifJP400",
  serifBold: "NotoSerifJP700",
} as const;

/** Interface type scale, px with line heights (plan 2.4, 1 rem = 16 px). */
export const typeScale = {
  caption: { size: 12, lineHeight: 16 },
  small: { size: 14, lineHeight: 20 },
  body: { size: 16, lineHeight: 24 },
  "title-sm": { size: 18, lineHeight: 26 },
  title: { size: 22, lineHeight: 30 },
  display: { size: 28, lineHeight: 36 },
} as const;

export type StorySize = "S" | "M" | "L" | "XL";

/**
 * Story text sizes (plan 2.4, the Story text size setting). `size` is the
 * Story text in px, `lineHeight` is unitless and leaves room for stacked
 * furigana. `furigana` is the reading size in px for the same setting.
 */
export const storyText: Record<StorySize, { size: number; lineHeight: number; furigana: number }> = {
  S: { size: 18, lineHeight: 2.0, furigana: 9 },
  M: { size: 21, lineHeight: 2.1, furigana: 10.5 },
  L: { size: 24, lineHeight: 2.2, furigana: 12 },
  XL: { size: 28, lineHeight: 2.2, furigana: 14 },
};

/** Corner radii in px (plan 2.5): 10 for cards and sheets, 8 for buttons and fields. */
export const radius = {
  base: 10,
  md: 8,
} as const;

export const tokens = {
  palette,
  fonts,
  typeScale,
  storyText,
  radius,
} as const;
