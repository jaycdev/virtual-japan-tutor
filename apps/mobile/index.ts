import { registerRootComponent } from "expo";

import App from "./App.tsx";

// File-local so it does not shadow Expo's typed asset require elsewhere.
declare function require(id: string): unknown;

// #42 spike: EXPO_PUBLIC_TRIAL=1 shows the throwaway spike screen instead of
// the app; #43 will remove the flag. require() is deliberate: a static import
// of the trial would drag global.css, the Uniwind runtime and 23.5 MB of Noto
// JP TTFs into every production bundle. Metro still resolves the require
// statically, so the real gating lives in metro.config.js, which aliases
// "@spike/trial" to ./trial-off (a null-returning stub) unless
// EXPO_PUBLIC_TRIAL=1; the flag check below then keeps the call itself dead.
// Android gotcha: registration must stay synchronous. Awaiting any native
// round-trip (SecureStore) before registerRootComponent means the bundle
// finishes evaluating with "main" unregistered and Expo Go shows
// "App entry not found". The trial therefore applies the saved theme inside
// the root component, which paints nothing until the theme is set (no flash).
if (process.env.EXPO_PUBLIC_TRIAL === "1") {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Metro's synchronous require; dynamic import would break root registration on Android
  const { Trial } = require("@spike/trial") as typeof import("./trial/index.ts");
  registerRootComponent(Trial);
} else {
  registerRootComponent(App);
}
