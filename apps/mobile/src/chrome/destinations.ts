import { BookOpen, Dumbbell, GraduationCap, House, Settings } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";

/**
 * The five destinations of the app shell (issue #44). `path` doubles as the
 * route to navigate to and the prefix that marks a route as "inside" it, so
 * /settings/server still lights up Settings and /stories/123 lights up Stories.
 */
export interface Destination {
  path: string;
  label: string;
  icon: LucideIcon;
}

export const DESTINATIONS: Destination[] = [
  { path: "/", label: "Today", icon: House },
  { path: "/stories", label: "Stories", icon: BookOpen },
  { path: "/practice", label: "Practice", icon: Dumbbell },
  { path: "/grammar", label: "Grammar", icon: GraduationCap },
  { path: "/settings", label: "Settings", icon: Settings },
];

/** Which destination a pathname belongs to ("/settings/server" → "/settings"). */
export function activeDestination(pathname: string): string {
  if (pathname === "/") return "/";
  // Segment-aware prefix: "/storiesfoo" must not light up Stories.
  const hit = DESTINATIONS.find(
    (d) => d.path !== "/" && (pathname === d.path || pathname.startsWith(d.path + "/")),
  );
  return hit?.path ?? "/";
}

/**
 * Reader routes (a Story or Grammar point opened full-screen): the bottom tab
 * bar hides there so the text gets the whole screen (the sidebar, which never
 * overlaps content, stays).
 */
export function isReaderRoute(pathname: string): boolean {
  return /^\/(stories|grammar)\/[^/]+/.test(pathname);
}
