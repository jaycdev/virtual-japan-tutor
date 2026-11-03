/* eslint-disable @typescript-eslint/no-require-imports -- expo-font wants Metro require() asset references */
// Android (and any other native target) ships the full static Noto JP TTFs and
// loads them through expo-font; the family names are the file base names, which
// is what expo-font registers them under and what the --font-* tokens in
// global.css reference. (Subsetting for payload is tracked after #43; the
// spike measured the worst case in TRIAL_RESULTS.md.)
export const appFonts: Record<string, number> = {
  NotoSansJP400: require("../assets/fonts/NotoSansJP400.ttf"),
  NotoSansJP700: require("../assets/fonts/NotoSansJP700.ttf"),
  NotoSerifJP400: require("../assets/fonts/NotoSerifJP400.ttf"),
  NotoSerifJP700: require("../assets/fonts/NotoSerifJP700.ttf"),
};
