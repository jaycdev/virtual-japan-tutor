import { describe, expect, it } from "vitest";

import { expoConfig } from "./app.config.ts";

describe("expoConfig", () => {
  it("builds the release app with the fallback version by default", () => {
    const config = expoConfig({});
    expect(config.name).toBe("Virtual Japan Tutor");
    expect(config.android?.package).toBe("com.jaycdev.virtualjapantutor");
    expect(config.version).toBe("0.1.0");
    expect(config.android?.versionCode).toBe(1);
  });

  it("builds the dev app under its own package and name", () => {
    const config = expoConfig({ APP_VARIANT: "dev" });
    expect(config.name).toBe("VJT Dev");
    expect(config.android?.package).toBe("com.jaycdev.virtualjapantutor.dev");
  });

  it("takes the version from the build environment", () => {
    const config = expoConfig({ APP_VERSION_NAME: "1.2.3", APP_VERSION_CODE: "1020399" });
    expect(config.version).toBe("1.2.3");
    expect(config.android?.versionCode).toBe(1020399);
  });

  it("rejects an unknown variant", () => {
    expect(() => expoConfig({ APP_VARIANT: "beta" })).toThrow(/APP_VARIANT/);
  });

  it("treats empty version variables as unset, like the version name", () => {
    const config = expoConfig({ APP_VERSION_NAME: "", APP_VERSION_CODE: "" });
    expect(config.version).toBe("0.1.0");
    expect(config.android?.versionCode).toBe(1);
  });

  it("rejects a version code that is not a positive integer", () => {
    expect(() => expoConfig({ APP_VERSION_CODE: "1.5" })).toThrow(/APP_VERSION_CODE/);
  });
});
