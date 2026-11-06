// The Settings sections (ui-plan 4.7), one list for both apps. The ids are the
// route segments (/settings/:section on web, settings/[section] on mobile), so
// they must not change: the Practice screen links to /settings/lists. The
// titles and blurbs are string-table entries (issue #125); the list carries
// the English copy today's apps render, and sectionTitle()/sectionBlurb()
// give the same rows in the Learner's Interface Language.

import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./i18n/language.ts";
import type { StringKey } from "./i18n/strings.ts";
import { translatePlain } from "./i18n/translate.ts";

export const SETTINGS_SECTIONS = [
  {
    id: "appearance",
    title: translatePlain("en", "section.appearanceTitle"),
    blurb: translatePlain("en", "section.appearanceBlurb"),
  },
  {
    id: "reading",
    title: translatePlain("en", "section.readingTitle"),
    blurb: translatePlain("en", "section.readingBlurb"),
  },
  {
    id: "stories",
    title: translatePlain("en", "section.storiesTitle"),
    blurb: translatePlain("en", "section.storiesBlurb"),
  },
  {
    id: "lists",
    title: translatePlain("en", "section.listsTitle"),
    blurb: translatePlain("en", "section.listsBlurb"),
  },
  {
    id: "level",
    title: translatePlain("en", "section.levelTitle"),
    blurb: translatePlain("en", "section.levelBlurb"),
  },
  {
    id: "marumori",
    title: translatePlain("en", "section.marumoriTitle"),
    blurb: translatePlain("en", "section.marumoriBlurb"),
  },
  {
    id: "ai",
    title: translatePlain("en", "section.aiTitle"),
    blurb: translatePlain("en", "section.aiBlurb"),
  },
  {
    id: "server",
    title: translatePlain("en", "section.serverTitle"),
    blurb: translatePlain("en", "section.serverBlurb"),
  },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

/** Narrows a route parameter to a known section (unknown values are not sections). */
export function findSettingsSection(id: string | undefined): (typeof SETTINGS_SECTIONS)[number] | undefined {
  return SETTINGS_SECTIONS.find((section) => section.id === id);
}

const SECTION_TITLES: Record<SettingsSection, StringKey> = {
  appearance: "section.appearanceTitle",
  reading: "section.readingTitle",
  stories: "section.storiesTitle",
  lists: "section.listsTitle",
  level: "section.levelTitle",
  marumori: "section.marumoriTitle",
  ai: "section.aiTitle",
  server: "section.serverTitle",
};

const SECTION_BLURBS: Record<SettingsSection, StringKey> = {
  appearance: "section.appearanceBlurb",
  reading: "section.readingBlurb",
  stories: "section.storiesBlurb",
  lists: "section.listsBlurb",
  level: "section.levelBlurb",
  marumori: "section.marumoriBlurb",
  ai: "section.aiBlurb",
  server: "section.serverBlurb",
};

/** A section's title in the Learner's Interface Language. */
export function sectionTitle(id: SettingsSection, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): string {
  return translatePlain(lang, SECTION_TITLES[id]);
}

/** The table key behind a section's title, so a screen can render <T> and keep furigana (issue #125). */
export function sectionTitleKey(id: SettingsSection): StringKey {
  return SECTION_TITLES[id];
}

/** The table key behind a section's blurb, same reason. */
export function sectionBlurbKey(id: SettingsSection): StringKey {
  return SECTION_BLURBS[id];
}

/** A section's blurb in the Learner's Interface Language. */
export function sectionBlurb(id: SettingsSection, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): string {
  return translatePlain(lang, SECTION_BLURBS[id]);
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
