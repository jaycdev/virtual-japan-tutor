// Node-side stand-in for react-native-screens (see vitest.setup.ts). expo-router
// loads the native-stack machinery at import time; on the jsdom (web) path none
// of these components render, they only need to exist as inert passthroughs.
function passthrough({ children }) {
  return children;
}

const KNOWN = {
  enableScreens: () => undefined,
  screensEnabled: () => false,
  shouldUseActivityState: () => true,
  featureFlags: { experiment: {} },
  ScreenStackHeaderBackButtonImage: passthrough,
};

// Unknown named exports become inert components; anything the module loader
// itself probes (then/default/__esModule/symbols) stays undefined.
module.exports = new Proxy(KNOWN, {
  get(target, property) {
    if (property in target) return target[property];
    if (typeof property !== "string") return undefined;
    if (["then", "catch", "default", "__esModule", "constructor", "name"].includes(property)) return undefined;
    return passthrough;
  },
});
