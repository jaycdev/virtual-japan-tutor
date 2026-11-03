// #43: Uniwind must be the outermost Metro wrapper (learned in the #42 spike).
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const config = getDefaultConfig(__dirname);

// The showcase screen is env-gated in index.ts, but Metro resolves every
// static require/import at build time, so the flag check alone would still
// ship the showcase modules and the bundled Noto JP fonts when the flag is
// off. This alias swaps the whole showcase folder for a one-line stub unless
// EXPO_PUBLIC_SHOWCASE=1.
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  "@dev/showcase":
    process.env.EXPO_PUBLIC_SHOWCASE === "1"
      ? path.resolve(__dirname, "showcase")
      : path.resolve(__dirname, "showcase-off"),
};

module.exports = withUniwindConfig(config, {
  cssEntryFile: "./global.css",
  dtsFile: "./uniwind-types.d.ts",
});
