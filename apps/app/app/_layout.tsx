import { Slot } from "expo-router";

import App from "../App";
import { Shell } from "../src/chrome/Shell.tsx";

// The router's root route renders the same shell App used to register: storage
// bootstrap, theme, auth gate. Inside it, Shell wraps the whole route tree in
// the chrome (#44): tab bar on narrow screens, sidebar on wide ones. Because
// Shell sits under AuthGate, the chrome only exists while signed in.
export default function RootLayout() {
  return (
    <App>
      <Shell>
        <Slot />
      </Shell>
    </App>
  );
}
