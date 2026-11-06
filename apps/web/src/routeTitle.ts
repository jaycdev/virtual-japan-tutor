import { useMatches } from "react-router";
import { translatePlain, type InterfaceLanguage, type StringKey } from "@vjt/core";

export const APP_NAME = "Virtual Japan Tutor";

/** Route handles that carry a page title. */
export interface RouteHandle {
  /** Page title as a string-table key; the document title becomes "<title> · Virtual Japan Tutor". */
  title?: StringKey;
  /**
   * Lift the shell's 960 px content cap for this route (the Story reader: its
   * column must keep ~40 characters per line at every Story text size, and
   * L and XL need more than 960 px to do that).
   */
  wide?: boolean;
  /**
   * False when the route swaps its own content inside <main> (the Settings
   * sections). The shell then focuses the element the page marks with
   * `data-page-focus` instead of <main> itself, so the section rail stays
   * immediately before the content in the tab order. Defaults to <main>.
   */
  shellFocus?: boolean;
}

/** The document title for a page-title key, in the Learner's Interface Language (or the app name alone). */
export function documentTitle(title: StringKey | undefined, language: InterfaceLanguage): string {
  return title ? `${translatePlain(language, title)} · ${APP_NAME}` : APP_NAME;
}

/** The string-table key of the deepest matched route that declares a title. */
export function useRouteTitle(): StringKey | undefined {
  const matches = useMatches();
  return matches
    .map((match) => (match.handle as RouteHandle | undefined)?.title)
    .filter((t): t is StringKey => Boolean(t))
    .at(-1);
}
