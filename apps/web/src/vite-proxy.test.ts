// The dev proxy must reach every top-level API path, or login and the rest of the
// app quietly break in development. The list is hand-written in vite.config.ts; this
// test reads the OpenAPI spec and fails when the two drift apart.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { API_PREFIXES } from "../api-prefixes.ts";

// vitest runs from the package directory (apps/web).
const SPEC = resolve(process.cwd(), "../../api/openapi.yaml");

/** The first path segment of every entry under `paths:` (e.g. "/stories/{id}" → "stories"). */
export function specTopLevelSegments(yaml: string): Set<string> {
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf("paths:");
  if (start === -1) throw new Error("openapi.yaml has no top-level paths: key");
  const segments = new Set<string>();
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break; // the next top-level key ends the paths block
    const match = /^ {2}\/([^\s/:]+)[^:]*:\s*$/.exec(line);
    if (match) segments.add(match[1] ?? "");
  }
  return segments;
}

describe("dev proxy coverage", () => {
  const spec = specTopLevelSegments(readFileSync(SPEC, "utf8"));
  const proxied = new Set<string>(API_PREFIXES);

  it("reads a non-trivial set of paths from the spec", () => {
    // Guards the parser itself: an empty or misread spec would make the other tests pass.
    expect(spec.size).toBeGreaterThanOrEqual(10);
    expect(spec.has("health")).toBe(true);
    expect(spec.has("auth")).toBe(true);
  });

  it("proxies every top-level API path in api/openapi.yaml", () => {
    const missing = [...spec].filter((segment) => !proxied.has(segment));
    expect(missing).toEqual([]);
  });

  it("proxies nothing the spec does not define (no stale entries)", () => {
    const stale = [...proxied].filter((prefix) => !spec.has(prefix));
    expect(stale).toEqual([]);
  });
});
