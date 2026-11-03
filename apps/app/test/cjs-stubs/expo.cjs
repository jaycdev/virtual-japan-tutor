// Node-side stand-in for the `expo` package umbrella (see vitest.setup.ts).
// Its real ESM build imports extensionless internals (Metro-style) and boots
// the native runtime — neither exists here. Only the optional-module probes
// are used by expo-router's splash handling.
const STUB = {
  // The expo package re-exports Platform from react-native; expo-router's
  // getInitialURL branches on it.
  Platform: require("./react-native.cjs").Platform,
  requireOptionalNativeModule: () => null,
  requireOptionalTurboModule: () => null,
  requireNativeModule: () => {
    throw new Error("expo stub: no native modules in tests");
  },
  getAutoLoadingMode: () => null,
  registerRootComponent: (component) => component,
  // expo-router's DOM-component bridge (skipped when EXPO_OS=web, but the
  // resolver shim routes every expo/* subpath here, including expo/dom/global).
  addGlobalDomEventListener: () => () => {},
  _emitGlobalEvent: () => {},
};

module.exports = STUB;
module.exports.default = STUB;
