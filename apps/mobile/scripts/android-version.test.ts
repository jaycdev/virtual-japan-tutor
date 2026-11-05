import { describe, expect, it } from "vitest";

import { versionFromDevBuild, versionFromReleaseTag } from "./android-version.mts";

describe("versionFromReleaseTag", () => {
  it("maps a final release tag to its name and code", () => {
    expect(versionFromReleaseTag("v1.2.3")).toEqual({ versionName: "1.2.3", versionCode: 1020399 });
  });

  it("keeps the release candidate in the name and sorts it below the final release", () => {
    expect(versionFromReleaseTag("v1.2.3-rc.2")).toEqual({ versionName: "1.2.3-rc.2", versionCode: 1020302 });
    expect(versionFromReleaseTag("v1.2.3-rc.98").versionCode).toBeLessThan(versionFromReleaseTag("v1.2.3").versionCode);
  });

  it("orders releases by version", () => {
    expect(versionFromReleaseTag("v0.9.99").versionCode).toBeLessThan(versionFromReleaseTag("v1.0.0-rc.1").versionCode);
    expect(versionFromReleaseTag("v1.0.0-rc.1").versionCode).toBeLessThan(versionFromReleaseTag("v1.0.0").versionCode);
  });

  it.each(["", "1.2.3", "v1.2", "vX.Y.Z", "v1.2.3-beta.1", "v1.2.3-rc", "v1.2.3-rc.0", "v1.2.3-rc.99", "v01.2.3", "v1.100.0", "v1.0.100"])(
    "rejects %j",
    (tag) => {
      expect(() => versionFromReleaseTag(tag)).toThrow();
    },
  );
});

describe("versionFromDevBuild", () => {
  it("names the dev build by run number and short commit", () => {
    expect(versionFromDevBuild(142, "1cfdacb9f0a1b2c3")).toEqual({ versionName: "dev.142+1cfdacb", versionCode: 142 });
  });

  it.each([
    [0, "1cfdacb"],
    [1.5, "1cfdacb"],
    [142, "xyz1234"],
    [142, "1cfdac"],
  ])("rejects run %s with sha %s", (run, sha) => {
    expect(() => versionFromDevBuild(run, sha)).toThrow();
  });
});
