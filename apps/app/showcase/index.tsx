// Import the design source BEFORE any component: uniwind compiles global.css
// into the native style store through this module edge; without it every
// className is inert (verified on device).
import "../global.css";

// The provider is `src/theme/index.tsx`; the legacy JS colour bridge that
// used to sit at `src/theme.ts` was deleted in #51.
import { ThemeProvider } from "@/src/theme/index.tsx";

import { Showcase as ShowcaseScreen } from "./Showcase.tsx";

// #43: dev-only showcase for the design foundations (palette, type scale,
// Story text sizes, fonts, theme provider, RNR overlays). Metro aliases
// "@dev/showcase" to ./showcase-off unless EXPO_PUBLIC_SHOWCASE=1, so this
// folder never reaches a production bundle. Not a product screen — the real
// screens arrive in #45..#50 and replace it.
//
// Wrapped in the real ThemeProvider so the showcase exercises the same
// boot path as the app: saved preference is applied before first paint, and
// the Light/Dark/System pills go through the same store the settings UI (#50)
// will use.
export function Showcase() {
  return (
    <ThemeProvider>
      <ShowcaseScreen />
    </ThemeProvider>
  );
}
