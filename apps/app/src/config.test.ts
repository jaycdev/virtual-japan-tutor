import { describe, expect, it } from "vitest";
import { normalizeServerUrl, resolveApiBaseUrl } from "./config.ts";

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

  it("prefers a stored override over the build-time env value", () => {
    expect(
      resolveApiBaseUrl({ EXPO_PUBLIC_API_URL: "http://env.test:8080" }, "http://saved.test:9000"),
    ).toBe("http://saved.test:9000");
  });

  it("ignores an unparseable stored override and falls back to the env", () => {
    expect(resolveApiBaseUrl({ EXPO_PUBLIC_API_URL: "http://env.test:8080" }, "nonsense")).toBe(
      "http://env.test:8080",
    );
  });
});

describe("normalizeServerUrl", () => {
  it("accepts and normalizes absolute http/https urls", () => {
    expect(normalizeServerUrl("http://192.168.50.12:8080")).toBe("http://192.168.50.12:8080");
    expect(normalizeServerUrl("  https://api.example.com/ ")).toBe("https://api.example.com");
    expect(normalizeServerUrl("https://api.example.com/api/v1")).toBe("https://api.example.com/api/v1");
  });

  it("rejects empty, relative and non-http input", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("   ")).toBeNull();
    expect(normalizeServerUrl("192.168.50.12:8080")).toBeNull();
    expect(normalizeServerUrl("ws://example.test")).toBeNull();
    expect(normalizeServerUrl("javascript:alert(1)")).toBeNull();
  });

  it("rejects urls with embedded credentials (auth is the bearer token's job)", () => {
    expect(normalizeServerUrl("http://admin:hunter2@192.168.1.10:8080")).toBeNull();
    expect(normalizeServerUrl("https://user@api.example.com")).toBeNull();
  });
});

describe("resolveApiBaseUrl with a stored override", () => {
  it("ignores a stored url that carries credentials", () => {
    expect(
      resolveApiBaseUrl({}, "http://admin:hunter2@192.168.1.10:8080"),
    ).toBe("http://10.0.2.2:8080");
  });
});
