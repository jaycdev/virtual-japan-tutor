import { describe, expect, test } from "vitest";

import { DESTINATIONS, activeDestination, isReaderRoute } from "./destinations.ts";

describe("destinations", () => {
  test("the five destinations, in order", () => {
    expect(DESTINATIONS.map((d) => [d.path, d.label])).toEqual([
      ["/", "Today"],
      ["/stories", "Stories"],
      ["/practice", "Practice"],
      ["/grammar", "Grammar"],
      ["/settings", "Settings"],
    ]);
  });

  test("a destination stays selected inside its routes", () => {
    expect(activeDestination("/")).toBe("/");
    expect(activeDestination("/stories")).toBe("/stories");
    expect(activeDestination("/stories/123")).toBe("/stories");
    expect(activeDestination("/settings")).toBe("/settings");
    expect(activeDestination("/settings/server")).toBe("/settings");
    // Unrouted paths fall back to Today rather than selecting nothing.
    expect(activeDestination("/nowhere")).toBe("/");
    // Prefix match is segment-aware: look-alikes must not select a tab.
    expect(activeDestination("/storiesfoo")).toBe("/");
    expect(activeDestination("/settingsx/foo")).toBe("/");
  });

  test("reader routes are the opened Story and Grammar point screens", () => {
    expect(isReaderRoute("/stories/123")).toBe(true);
    expect(isReaderRoute("/grammar/des-u")).toBe(true);
    expect(isReaderRoute("/stories")).toBe(false);
    expect(isReaderRoute("/grammar")).toBe(false);
    expect(isReaderRoute("/settings/server")).toBe(false);
    expect(isReaderRoute("/")).toBe(false);
  });
});
