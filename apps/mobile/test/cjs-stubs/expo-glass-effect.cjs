// Node-side stand-in for expo-glass-effect (iOS 26 glass chrome; see
// vitest.setup.ts). The real package is ESM with extensionless imports and a
// native TurboModule — both inert here.
function passthrough({ children }) {
  return children;
}

module.exports = {
  GlassView: passthrough,
  GlassContainer: passthrough,
  isLiquidGlassAvailable: () => false,
  isGlassEffectAPIAvailable: () => false,
};
