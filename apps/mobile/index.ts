import { registerRootComponent } from "expo";

import App from "./App.tsx";
import { Trial } from "./trial/Trial.tsx";

// #42 spike: EXPO_PUBLIC_TRIAL=1 shows the throwaway spike screen instead of
// the app; #43 will remove the flag.
// Android gotcha: registration must stay synchronous. Awaiting any native
// round-trip (SecureStore) before registerRootComponent means the bundle
// finishes evaluating with "main" unregistered and Expo Go shows
// "App entry not found". The trial therefore applies the saved theme inside
// the root component, which paints nothing until the theme is set (no flash).
registerRootComponent(process.env.EXPO_PUBLIC_TRIAL === "1" ? Trial : App);
