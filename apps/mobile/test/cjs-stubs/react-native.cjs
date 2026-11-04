// Node-side 'react-native' (see vitest.setup.ts): react-native-web itself, plus
// the handful of registry seams expo-router's compiled CJS touches that RNW has
// no equivalent for (its native-component lookups fall back to a plain view).
const rnw = require("react-native-web");

function passthroughComponent() {
  function Comp({ children }) {
    return children;
  }
  return Comp;
}

module.exports = {
  ...rnw,
  NativeComponentRegistry: {
    get: (_name, fallback) => fallback(),
    register: () => undefined,
  },
  // Native-component seams react-native-screens uses at require time.
  codegenNativeComponent: () => passthroughComponent(),
  requireNativeComponent: () => passthroughComponent(),
};
