// Benign stand-in for expo-modules-core (test only). expo-linking and friends
// require() it at load; nothing in tests calls into real native modules.
// Written in plain ES5 CJS: vite inlines expo-* packages and parses this file
// with an ESM parser, so no class or shorthand-method syntax.
var noopSubscription = { remove: function () {} };

var nativeModules = new Proxy(
  {},
  {
    get: function (_target, prop) {
      if (prop === "then") return undefined;
      return {};
    },
  }
);

function EventEmitterStub() {}
EventEmitterStub.prototype.addListener = function () {
  return noopSubscription;
};
EventEmitterStub.prototype.addListenerOnce = function () {
  return noopSubscription;
};
EventEmitterStub.prototype.removeListener = function () {};
EventEmitterStub.prototype.removeAllListeners = function () {};
EventEmitterStub.prototype.emit = function () {};

// expo-modules-core (SDK 54+) also re-exports Platform; expo-linking's Schemes
// uses Platform.select.
var Platform = {
  OS: "web",
  constants: { reactNative: { PlatformConstants: {} } },
  isTesting: false,
  isTV: false,
  select: function (obj) {
    return "web" in obj ? obj.web : obj.default;
  },
};

module.exports = {
  Platform: Platform,
  NativeModules: nativeModules,
  TurboModuleRegistry: {
    getEnforced: function () {
      return {};
    },
    get: function () {
      return null;
    },
    select: function (modules) {
      return modules && modules.length > 0 ? modules[0] : {};
    },
  },
  requireNativeModule: function () {
    return {};
  },
  requireOptionalNativeModule: function () {
    return null;
  },
  EventEmitter: EventEmitterStub,
  SharedObject: undefined,
};

// CJS default-import interop: `import ExpoModulesCore from "expo-modules-core"`
// inside inlined expo-* code expects the namespace as the default export.
module.exports.default = module.exports;
