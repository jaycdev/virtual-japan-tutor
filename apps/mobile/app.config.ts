import type { ConfigContext, ExpoConfig } from "expo/config";
import { palette } from "@vjt/design";

type BuildEnv = Record<string, string | undefined>;

const RELEASE_PACKAGE = "com.jaycdev.virtualjapantutor";

/**
 * Expo config for the Android APK (ADR-0012).
 *
 * APP_VARIANT: "release" (default) or "dev". The dev app has its own package, so it installs
 * next to the release app. APP_VERSION_NAME / APP_VERSION_CODE come from CI
 * (scripts/print-android-version.mjs); local builds fall back to 0.1.0 / 1. Empty values count as unset.
 */
export function expoConfig(env: BuildEnv): ExpoConfig {
  const variant = env.APP_VARIANT || "release";
  if (variant !== "release" && variant !== "dev") {
    throw new Error(`APP_VARIANT must be "release" or "dev", got "${variant}"`);
  }
  const dev = variant === "dev";

  const rawVersionCode = env.APP_VERSION_CODE || undefined;
  const versionCode = rawVersionCode === undefined ? 1 : Number(rawVersionCode);
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error(`APP_VERSION_CODE must be a positive integer, got "${rawVersionCode}"`);
  }

  return {
    name: dev ? "VJT Dev" : "Virtual Japan Tutor",
    slug: "virtual-japan-tutor",
    version: env.APP_VERSION_NAME || "0.1.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "automatic",
    platforms: ["android"],
    android: {
      package: dev ? `${RELEASE_PACKAGE}.dev` : RELEASE_PACKAGE,
      versionCode,
      adaptiveIcon: {
        // The adaptive icon's background is a raw value, so it reads the design token (ADR-0009/0010).
        backgroundColor: palette.light.background,
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
    },
    plugins: ["expo-font", "expo-router", "./plugins/withReleaseSigning.js"],
  };
}

export default (_ctx: ConfigContext): ExpoConfig => expoConfig(process.env);
