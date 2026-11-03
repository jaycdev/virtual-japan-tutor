// #42 spike: Uniwind must be the outermost Metro wrapper.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// The spike screen is env-gated in index.ts, but Metro resolves every static
// require/import at build time, so the flag check alone would still ship the
// trial modules and 23.5 MB of subset TTFs when the flag is off. This alias
// swaps the whole trial folder for a one-line stub unless EXPO_PUBLIC_TRIAL=1.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@spike/trial":
    process.env.EXPO_PUBLIC_TRIAL === "1"
      ? path.resolve(__dirname, "trial")
      : path.resolve(__dirname, "trial-off"),
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
