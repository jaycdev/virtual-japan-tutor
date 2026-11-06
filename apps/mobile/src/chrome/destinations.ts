import { BookOpen, Dumbbell, GraduationCap, House, Settings } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { translatePlain, type StringKey } from "@vjt/core";

/**
 * The five destinations of the app shell (issue #44). `path` doubles as the
 * route to navigate to and the prefix that marks a route as "inside" it, so
 * /settings/server still lights up Settings and /stories/123 lights up Stories.
 * The label lives in the string table (issue #125): `labelKey` is what the
 * tab bar renders in the Learner's Interface Language, `label` is the English
 * row of the same entry for routing, tests and any plain-text fallback.
 */
export interface Destination {
  path: string;
  label: string;
  labelKey: StringKey;
  icon: LucideIcon;
}

export const DESTINATIONS: Destination[] = [
  { path: "/", label: translatePlain("en", "nav.today"), labelKey: "nav.today", icon: House },
  { path: "/stories", label: translatePlain("en", "nav.stories"), labelKey: "nav.stories", icon: BookOpen },
  { path: "/practice", label: translatePlain("en", "nav.practice"), labelKey: "nav.practice", icon: Dumbbell },
  { path: "/grammar", label: translatePlain("en", "nav.grammar"), labelKey: "nav.grammar", icon: GraduationCap },
  { path: "/settings", label: translatePlain("en", "nav.settings"), labelKey: "nav.settings", icon: Settings },
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
