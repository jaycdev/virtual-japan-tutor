// Web gets its Noto JP faces from the @font-face + unicode-range slices in
// global.css (ADR-0009) — no expo-font needed, and the TTFs never enter the
// web bundle. Metro picks fonts.native.ts for Android instead, so importers
// must keep the specifier extensionless ("./src/fonts", never "./src/fonts.ts")
// for that platform resolution to apply.
export const appFonts: Record<string, number> = {};
