import { describe, expect, it } from "vitest";
import { resolveApiBaseUrl } from "./config.ts";

describe("resolveApiBaseUrl", () => {
  it("defaults to the host machine as seen from the Android emulator", () => {
    expect(resolveApiBaseUrl({})).toBe("http://10.0.2.2:8080");
  });

  it("uses EXPO_PUBLIC_API_URL when set, without a trailing slash", () => {
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_URL: "http://docker-dev.internal:8080/" })).toBe(
      "http://docker-dev.internal:8080",
    );
  });

  it("treats an empty value as unset", () => {
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_URL: "" })).toBe("http://10.0.2.2:8080");
  });
});
