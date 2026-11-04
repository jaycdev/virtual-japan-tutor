// Uniwind's Metro patch adds global.css to the graph automatically only in dev
// (see uniwind metro/index.cjs, initialTraverseDependencies), so the import is
// kept explicit for production builds, where className is otherwise dropped.
import "../global.css";

import { Slot } from "expo-router";

import App from "../App";
import { Shell } from "../src/chrome/Shell.tsx";

// The router's root route renders the same shell App used to register: storage
// bootstrap, theme, auth gate. Inside it, Shell wraps the whole route tree in
// the tab bar (#44). Because Shell sits under AuthGate, the chrome only exists
// while signed in.
export default function RootLayout() {
  return (
    <App>
      <Shell>
        <Slot />
      </Shell>
    </App>
  );
}
