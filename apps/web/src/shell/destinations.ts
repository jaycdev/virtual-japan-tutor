/**
 * The five destinations (ui-plan 3). `path` is both the route and the prefix that
 * marks a route as "inside" it, so /settings/appearance lights up Settings and
 * /stories/123 lights up Stories.
 */
export interface Destination {
  path: string;
  label: string;
}

export const DESTINATIONS: Destination[] = [
  { path: "/", label: "Today" },
  { path: "/stories", label: "Stories" },
  { path: "/practice", label: "Practice" },
  { path: "/grammar", label: "Grammar" },
  { path: "/settings", label: "Settings" },
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
