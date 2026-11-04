import { describe, expect, it } from "vitest";

import { loginPathFor, safeNextPath } from "./nextPath.ts";

const ORIGIN = "https://vjt.example.test";

describe("safeNextPath", () => {
  it.each([
    ["/stories", "/stories"],
    ["/stories/12?from=today#p3", "/stories/12?from=today#p3"],
    ["/settings/appearance", "/settings/appearance"],
    ["/", "/"],
  ])("keeps the same-origin path %s", (raw, expected) => {
    expect(safeNextPath(raw, ORIGIN)).toBe(expected);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["an absolute URL", "https://evil.example.com/steal"],
    ["a scheme-relative URL", "//evil.example.com"],
    ["a backslash-slash URL", "/\\evil.example.com"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path without a slash", "stories"],
    ["a path with a tab in it", "/stories\t//evil.example.com"],
    ["a path with a newline", "/stories\n"],
    ["a path with a backslash", "/stories\\..\\admin"],
    ["the login page itself", "/login"],
    ["the login page with a query", "/login?next=/stories"],
  ])("falls back to the landing page for %s", (_label, raw) => {
    expect(safeNextPath(raw, ORIGIN)).toBe("/");
  });

  it("keeps an encoded slash inside the path rather than reading it as a host", () => {
    // %2F stays an ordinary character in the path; the result is still this site.
    const result = safeNextPath("/%2F%2Fevil.example.com", ORIGIN);
    expect(new URL(result, ORIGIN).origin).toBe(ORIGIN);
  });
});

describe("loginPathFor", () => {
  it("omits next when the Learner was headed to the landing page", () => {
    expect(loginPathFor("/")).toBe("/login");
  });

  it("encodes the page the Learner asked for", () => {
    expect(loginPathFor("/stories/9?x=1&y=2")).toBe("/login?next=%2Fstories%2F9%3Fx%3D1%26y%3D2");
  });

  it("round-trips through safeNextPath", () => {
    const from = "/grammar/abc?level=N3#top";
    const search = new URL(loginPathFor(from), ORIGIN).searchParams.get("next");
    expect(safeNextPath(search, ORIGIN)).toBe(from);
  });
});
