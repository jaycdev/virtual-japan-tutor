// Node-side stand-in for react-native-gesture-handler (see vitest.setup.ts).
// The real package installs worklet machinery for the native host; expo-router
// only needs its exports to exist on the jsdom (web) path.
function passthrough({ children }) {
  return children;
}

// Gesture builders chain infinitely: every property read returns a function
// that hands back the same inert chain object.
const chain = new Proxy(function () {}, {
  get(_target, property) {
    if (typeof property !== "string") return undefined;
    if (["then", "catch", "default", "__esModule", "constructor", "name", "call", "apply"].includes(property))
      return undefined;
    return () => chain;
  },
  apply() {
    return chain;
  },
});

const KNOWN = {
  GestureHandlerRootView: passthrough,
  Gesture: chain,
  GestureDetector: passthrough,
  NativeViewGestureHandler: passthrough,
  gestureHandlerRootHOC: (component) => component,
};

module.exports = new Proxy(KNOWN, {
  get(target, property) {
    if (property in target) return target[property];
    if (typeof property !== "string") return undefined;
    if (["then", "catch", "default", "__esModule", "constructor", "name"].includes(property)) return undefined;
    return passthrough;
  },
});
