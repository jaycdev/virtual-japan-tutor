/* eslint-disable @typescript-eslint/no-require-imports -- expo-font wants Metro require() asset references */
import { Platform } from "react-native";

// #42 spike (ADR-0009, plan 2.4): Noto Sans JP for the interface, Noto Serif
// JP for story text, bundled and loaded with expo-font on both platforms.
// The family names double as the font file base names, which is what
// expo-font registers them under on Android.
//
// Android ships subsetting-to-Japanese TTFs; web ships the same subset as
// woff2 so the export payload stays sane (numbers in TRIAL_RESULTS.md).
export const trialFonts: Record<string, number> =
  Platform.OS === "web"
    ? {
        "NotoSansJP-400": require("../assets/fonts/web/NotoSansJP-400.woff2"),
        "NotoSansJP-700": require("../assets/fonts/web/NotoSansJP-700.woff2"),
        "NotoSerifJP-400": require("../assets/fonts/web/NotoSerifJP-400.woff2"),
        "NotoSerifJP-700": require("../assets/fonts/web/NotoSerifJP-700.woff2"),
      }
    : {
        "NotoSansJP-400": require("../assets/fonts/NotoSansJP-400.ttf"),
        "NotoSansJP-700": require("../assets/fonts/NotoSansJP-700.ttf"),
        "NotoSerifJP-400": require("../assets/fonts/NotoSerifJP-400.ttf"),
        "NotoSerifJP-700": require("../assets/fonts/NotoSerifJP-700.ttf"),
      };

export const SANS = "NotoSansJP-400";
export const SANS_BOLD = "NotoSansJP-700";
export const SERIF = "NotoSerifJP-400";
export const SERIF_BOLD = "NotoSerifJP-700";
