import type { Story, StoryGenerationProgress } from "@vjt/api-client";
import {
  DEFAULT_INTERFACE_LANGUAGE,
  type InterfaceLanguage,
} from "./i18n/language.ts";
import type { StringKey } from "./i18n/strings.ts";
import { translatePlain } from "./i18n/translate.ts";

/**
 * Story words in the Learner's language, shared by the Stories screens (issue
 * #79 moved these out of apps/mobile's stories-parts). Pure functions: the
 * apps own the markup, the wording lives here once. Issue #125 gave each one
 * an Interface Language, defaulting to English so today's call sites and
 * copy are unchanged.
 */

/** Story Origin in Learner's words. */
export function originLabel(
  story: Pick<Story, "origin">,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return translatePlain(lang, story.origin === "on_demand" ? "story.originOnDemand" : "story.originAutomatic");
}

/**
 * Genre ids in the Learner's words; an unknown genre shows as-is in either
 * language — a Learner can type any genre, and its own words are its label.
 * English maps only diary/travel/mystery (issue #79); Japanese also maps the
 * server's eight preset genres (story/service.go). Display-only: what is
 * stored and sent stays the English id. One table path for both languages:
 * the same lookup, the same case handling, and the same pass-through for a
 * genre the table has never seen (issue #125 review S16).
 */
const GENRE_STRINGS: Record<string, StringKey> = {
  diary: "genre.diary",
  travel: "genre.travel",
  mystery: "genre.mystery",
  "slice of life": "genre.sliceOfLife",
  folktale: "genre.folktale",
  food: "genre.food",
  "school life": "genre.schoolLife",
  "city life": "genre.cityLife",
  nature: "genre.nature",
};

export function genreLabel(
  genre: string | null | undefined,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  if (genre === null || genre === undefined) return "";
  const key = GENRE_STRINGS[genre.toLowerCase()];
  return key === undefined ? genre : translatePlain(lang, key);
}

const EN_DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });
const JA_DATE = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" });

/** The card's date, short and unambiguous: "Nov 1, 2026" / "2026年11月1日". */
export function storyDate(
  iso: string,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return (lang === "en" ? EN_DATE : JA_DATE).format(new Date(iso));
}

/**
 * The Genre / Story Origin / date line of a Library card: "Diary · Automatic ·
 * Nov 1, 2026". A Story without a Genre says "Story" in its place.
 */
export function storyCardMeta(story: Story, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): string {
  return `${genreLabel(story.genre, lang) || translatePlain(lang, "story.noGenre")} · ${originLabel(story, lang)} · ${storyDate(story.createdAt, lang)}`;
}

const STAGE_STRINGS = {
  preparing: "stage.preparing",
  writing: "stage.writing",
  checking: "stage.checking",
  saving: "stage.saving",
} as const;

/** The Learner-facing stage of a generation run, in every place a run shows progress. */
export function stageLabel(
  progress: StoryGenerationProgress,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  const key = STAGE_STRINGS[progress.stage as keyof typeof STAGE_STRINGS];
  if (key === undefined) return translatePlain(lang, "stage.writing");
  if (progress.stage === "writing" && progress.attempt != null && progress.maxAttempts != null) {
    return translatePlain(lang, "stage.writingAttempt", {
      attempt: progress.attempt,
      max: progress.maxAttempts,
    });
  }
  return translatePlain(lang, key);
}

/** The progress line a run shows: its stage and the rounded percent. */
export function progressLabel(
  progress: StoryGenerationProgress,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return `${stageLabel(progress, lang)} ${Math.round(progress.percent ?? 0)}%`;
}
