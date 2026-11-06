import type { StringKey } from "@vjt/core";

/**
 * The five destinations (ui-plan 3). `path` is both the route and the prefix that
 * marks a route as "inside" it, so /settings/appearance lights up Settings and
 * /stories/123 lights up Stories. `labelKey` is the string-table entry NavList
 * renders in the Interface Language (issue #125).
 */
export interface Destination {
  path: string;
  labelKey: StringKey;
}

export const DESTINATIONS: Destination[] = [
  { path: "/", labelKey: "nav.today" },
  { path: "/stories", labelKey: "nav.stories" },
  { path: "/practice", labelKey: "nav.practice" },
  { path: "/grammar", labelKey: "nav.grammar" },
  { path: "/settings", labelKey: "nav.settings" },
];

/** Which destination a pathname belongs to ("/settings/appearance" → "/settings"). */
export function activeDestination(pathname: string): string {
  if (pathname === "/") return "/";
  // Segment-aware prefix: "/storiesfoo" must not light up Stories.
  const hit = DESTINATIONS.find(
    (d) => d.path !== "/" && (pathname === d.path || pathname.startsWith(`${d.path}/`)),
  );
  return hit?.path ?? "/";
}
