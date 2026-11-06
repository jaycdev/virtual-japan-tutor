import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// The plugin is plain CommonJS (Expo loads it straight from app.config.ts).
const require = createRequire(import.meta.url);
const { applyReleaseSigning } = require("./withReleaseSigning.js") as {
  applyReleaseSigning: (gradle: string, env?: Record<string, string | undefined>) => string;
};

// The shape Expo's template generates for app/build.gradle.
const TEMPLATE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore.
            signingConfig signingConfigs.debug
            minifyEnabled false
        }
    }
}
`;

const SIGNING_ENV = {
  ANDROID_KEYSTORE_PATH: "/tmp/vjt-release.jks",
  ANDROID_KEYSTORE_PASSWORD: "store-pass",
  ANDROID_KEY_ALIAS: "vjt",
  ANDROID_KEY_PASSWORD: "key-pass",
};

describe("applyReleaseSigning", () => {
  it("leaves the template alone when no signing variables are set", () => {
    expect(applyReleaseSigning(TEMPLATE, {})).toBe(TEMPLATE);
  });

  it("signs only the release build type with a release config read from the environment", () => {
    const out = applyReleaseSigning(TEMPLATE, SIGNING_ENV);

    expect(out).toContain("release {\n            storeFile file(System.getenv(\"ANDROID_KEYSTORE_PATH\"))");
    expect(out).toContain('keyAlias System.getenv("ANDROID_KEY_ALIAS")');
    expect(out).toMatch(/release \{\n\s*\/\/ Caution[^\n]*\n\s*signingConfig signingConfigs\.release/);
    // The debug build type keeps the debug key.
    expect(out).toMatch(/debug \{\n\s*signingConfig signingConfigs\.debug/);
    // Secrets stay out of the generated file: Gradle reads them from the environment at build time.
    expect(out).not.toContain("store-pass");
    expect(out).not.toContain("key-pass");
  });

  it("refuses to half-configure signing", () => {
    const { ANDROID_KEY_PASSWORD: _omitted, ...partial } = SIGNING_ENV;
    expect(() => applyReleaseSigning(TEMPLATE, partial)).toThrow(/ANDROID_KEY_PASSWORD/);
  });

  it("fails loudly when the template has no release build type to sign", () => {
    const withoutRelease = TEMPLATE.replace("signingConfig signingConfigs.debug\n            minifyEnabled", "minifyEnabled");
    expect(() => applyReleaseSigning(withoutRelease, SIGNING_ENV)).toThrow(/release/);
  });
});
