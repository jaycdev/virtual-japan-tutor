import { registerRootComponent } from "expo";

import App from "./App.tsx";

// File-local so it does not shadow Expo's typed asset require elsewhere.
declare function require(id: string): unknown;

// #43: EXPO_PUBLIC_SHOWCASE=1 shows the dev-only foundations showcase instead
// of the app. The flag check is not enough on its own: Metro resolves every
// static require at build time, so the real gating lives in metro.config.js,
// which aliases "@dev/showcase" to ./showcase-off (a null-returning stub)
// unless EXPO_PUBLIC_SHOWCASE=1; the check below then keeps the call itself
// dead. Android gotcha (from #42): registration must stay synchronous.
// Awaiting any native round-trip (SecureStore) before registerRootComponent
// means the bundle finishes evaluating with "main" unregistered and Expo Go
// shows "App entry not found". Theme and font bootstrapping therefore live
// inside the roots (ThemeProvider / useFonts), which paint nothing until the
// saved theme and the bundled fonts are in place.
if (process.env.EXPO_PUBLIC_SHOWCASE === "1") {
  const { Showcase } = require("@dev/showcase") as typeof import("./showcase/index.tsx");
  registerRootComponent(Showcase);
} else {
  registerRootComponent(App);
}
