import { useMatches } from "react-router";

export const APP_NAME = "Virtual Japan Tutor";

/** Route handles that carry a page title. */
export interface RouteHandle {
  /** Page title; the document title becomes "<title> · Virtual Japan Tutor". */
  title?: string;
  /**
   * Lift the shell's 960 px content cap for this route (the Story reader: its
   * column must keep ~40 characters per line at every Story text size, and
   * L and XL need more than 960 px to do that).
   */
  wide?: boolean;
}

/** The document title for a page title (or the app name alone). */
export function documentTitle(title: string | undefined): string {
  return title ? `${title} · ${APP_NAME}` : APP_NAME;
}

/** The title of the deepest matched route that declares one. */
export function useRouteTitle(): string | undefined {
  const matches = useMatches();
  return matches
    .map((match) => (match.handle as RouteHandle | undefined)?.title)
    .filter((t): t is string => Boolean(t))
    .at(-1);
}
