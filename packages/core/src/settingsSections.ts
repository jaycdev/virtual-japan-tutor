// The Settings sections (ui-plan 4.7), one list for both apps. The ids are the
// route segments (/settings/:section on web, settings/[section] on mobile), so
// they must not change: the Practice screen links to /settings/lists.

export const SETTINGS_SECTIONS = [
  { id: "appearance", title: "Appearance", blurb: "Colour theme and Story text size" },
  { id: "reading", title: "Reading", blurb: "Translation blur and Lookup hold" },
  { id: "stories", title: "Stories", blurb: "Furigana threshold and future story tastes" },
  { id: "lists", title: "Item Lists", blurb: "Lists, boosting and saved items" },
  { id: "level", title: "Starting Level", blurb: "N5–N1 known grammar baseline" },
  { id: "marumori", title: "MaruMori", blurb: "Connect your Junji profile and Sync" },
  { id: "ai", title: "AI Providers", blurb: "Endpoints, keys and task assignments" },
  { id: "server", title: "Server", blurb: "Connection health and server address" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Narrows a route parameter to a known section (unknown values are not sections). */
export function findSettingsSection(id: string | undefined): (typeof SETTINGS_SECTIONS)[number] | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}

/**
 * What a section's step-save reports to the setup wizard (review S2):
 * "saved" wrote something, "nothing" had no entered input to write,
 * "blocked" tried and failed — the section shows its own error and the
 * wizard stays put.
 */
export type StepSaveOutcome = "saved" | "nothing" | "blocked";

/** The step-save itself: runs the section's save, reports the outcome. */
export type StepSaveFn = () => Promise<StepSaveOutcome>;

/**
 * How a section hands its save to the setup wizard: it calls the registrar with
 * its save while mounted (and with null on unmount), so Next/Finish reuse the
 * section's Save rather than duplicating it. The Settings pages never pass one.
 */
export type StepSaveRegistrar = (save: StepSaveFn | null) => void;
