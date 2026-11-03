// Node-side stand-in for react-native-safe-area-context (see vitest.setup.ts):
// the real package compiles its native spec at require time, which needs the
// Expo native host. Inert zero insets are what the jsdom harness needs.
const React = require("react");

const INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const FRAME = { x: 0, y: 0, width: 0, height: 0 };
const INITIAL_METRICS = { insets: INSETS, frame: FRAME };

function passthrough({ children }) {
  return children;
}

module.exports = {
  SafeAreaProvider: passthrough,
  SafeAreaFrameProvider: passthrough,
  // expo-router's web safe-area layer writes these directly (the real package
  // exports the contexts on every platform).
  SafeAreaFrameContext: React.createContext(FRAME),
  SafeAreaInsetsContext: React.createContext(INSETS),
  initialWindowMetrics: INITIAL_METRICS,
  useSafeAreaInsets: () => INSETS,
  useSafeAreaFrame: () => FRAME,
  withSafeAreaInsets: (Component) => Component,
};

