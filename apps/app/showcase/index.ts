// Import the design source BEFORE any component: uniwind compiles global.css
// into the native style store through this module edge; without it every
// className is inert (verified on device).
import "../global.css";

// #43: dev-only showcase for the design foundations (palette, type scale,
// Story text sizes, fonts, theme provider, RNR overlays). Metro aliases
// "@dev/showcase" to ./showcase-off unless EXPO_PUBLIC_SHOWCASE=1, so this
// folder never reaches a production bundle. Not a product screen — the real
// screens arrive in #45..#50 and replace it.
export { Showcase } from "./Showcase.tsx";
