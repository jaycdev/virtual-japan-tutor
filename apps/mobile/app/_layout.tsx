// The design source must be imported for the PRODUCTION web build: uniwind's
// Metro patch adds global.css to the graph automatically only in dev (see
// uniwind metro/index.cjs, initialTraverseDependencies), so `expo export -p web`
// without this import ships no Tailwind CSS and the web app renders unstyled.
// Same pattern as showcase/index.tsx; a no-op on native, where className is
// compiled to styles.
import "../global.css";

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
