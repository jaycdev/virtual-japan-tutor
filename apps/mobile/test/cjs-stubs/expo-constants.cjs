// Node-side stand-in for expo-constants (see vitest.setup.ts). No app config,
// no native host — expo-router only inspects these to decide platform chrome.
const CONSTANTS = {
  expoConfig: null,
  expoConfigNoEnv: null,
  expo: { config: {}, status: {} },
  appId: null,
  appIdHash: null,
  nativeAppVersion: null,
  systemFonts: [],
  statusBar: null,
  linkedProperties: {},
  deviceId: "test-device",
  installationId: null,
  launcherFlags: {},
  platformRegistryId: null,
  userAgent: "vjt-test",
};

module.exports = CONSTANTS;
module.exports.default = CONSTANTS;
module.exports.expoConfig = null;
module.exports.expo = CONSTANTS.expo;
module.exports.statusBar = null;
module.exports.systemFonts = [];
