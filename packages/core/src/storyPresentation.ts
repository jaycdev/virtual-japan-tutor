import type { Story, StoryGenerationProgress } from "@vjt/api-client";
import {
  DEFAULT_INTERFACE_LANGUAGE,
  type InterfaceLanguage,
} from "./i18n/language.ts";
import type { StringKey } from "./i18n/strings.ts";
import { translate, translatePlain, type TranslateParams } from "./i18n/translate.ts";
import type { RubyText } from "./i18n/ruby.ts";
import { formatDateRuby } from "./i18n/dates.ts";

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
 * English maps only diary/travel/mystery, matched exactly as stored — the
 * case-sensitive matching of the switch that shipped before the Interface
 * Language work (issue #79), so "DIARY" shows as typed; every other genre
 * shows exactly as stored. Japanese also maps the server's preset genres
 * (story/service.go), case-insensitively. Display-only: what is stored and
 * sent stays the English id. One table path for both languages: the same
 * lookup and the same pass-through for a genre the table has never seen.
 * A typed genre like "constructor" names an
 * Object.prototype member, not a table row, so the lookup only trusts own
 * properties.
 */
const GENRE_STRINGS_JA: Record<string, StringKey> = {
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

const GENRE_STRINGS: Record<InterfaceLanguage, Record<string, StringKey>> = {
  en: {
    diary: "genre.diary",
    travel: "genre.travel",
    mystery: "genre.mystery",
  },
  // The two Japanese settings speak the same words; only the furigana differs.
  ja: GENRE_STRINGS_JA,
  "ja-furigana": GENRE_STRINGS_JA,
};

export function genreLabel(
  genre: string | null | undefined,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  if (genre === null || genre === undefined) return "";
  const table = GENRE_STRINGS[lang];
  const id = lang === "en" ? genre : genre.toLowerCase();
  const key = Object.hasOwn(table, id) ? table[id] : undefined;
  return key === undefined ? genre : translatePlain(lang, key);
}

const EN_DATE = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });
const JA_DATE = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "long", day: "numeric" });

/**
 * The card's date, short and unambiguous: "Nov 1, 2026" / "2026年11月1日".
 */
export function storyDate(
  iso: string,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return (lang === "en" ? EN_DATE : JA_DATE).format(new Date(iso));
}

/**
 * The same date as base/reading segments: en and ja are the one plain string
 * storyDate speaks; ja-furigana reads 年月日 (issue #125). The
 * English options stay month-short exactly as EN_DATE has them.
 */
export function storyDateRuby(
  iso: string,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): RubyText {
  // en and ja are storyDate's own string, through its already-cached
  // formatters (issue #125); only furigana builds parts.
  if (lang !== "ja-furigana") return [{ text: storyDate(iso, lang) }];
  return formatDateRuby(iso, { year: "numeric", month: "long", day: "numeric" }, lang);
}

/**
 * The Reader's meta line exactly as English showed it before the string table:
 * the raw Genre (empty when there is none, not "Story"),
 * the two Origin words, and the toDateString() date. English stays byte-identical
 * to that; Japanese gets the translated line from storyCardMeta.
 */
export function storyMetaEn(story: Story): string {
  return `${story.genre} · ${story.origin === "on_demand" ? "On demand" : "Automatic"} · ${new Date(story.createdAt).toDateString()}`;
}

/**
 * The Genre / Story Origin / date line of a Library card: "Diary · Automatic ·
 * Nov 1, 2026". A Story without a Genre says "Story" in its place.
 */
export function storyCardMeta(story: Story, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): string {
  return `${genreLabel(story.genre, lang) || translatePlain(lang, "story.noGenre")} · ${originLabel(story, lang)} · ${storyDate(story.createdAt, lang)}`;
}

/**
 * Story Origin as base/reading segments, for screens that draw furigana with
 * <TableText> — the same words as originLabel, readings kept in ja-furigana
 * (issue #125).
 */
export function originRuby(story: Pick<Story, "origin">, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): RubyText {
  return translate(lang, story.origin === "on_demand" ? "story.originOnDemand" : "story.originAutomatic");
}

/** The Genre in the same segment form; a genre the table has never seen passes through plain. */
export function genreRuby(genre: string | null | undefined, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): RubyText {
  // An empty genre is "no genre" like null, not a word to show: storyCardMetaRuby
  // falls back to the label only when this returns no segments (issue #125).
  if (!genre) return [];
  const table = GENRE_STRINGS[lang];
  const id = lang === "en" ? genre : genre.toLowerCase();
  const key = Object.hasOwn(table, id) ? table[id] : undefined;
  return key === undefined ? [{ text: genre }] : translate(lang, key);
}

/** The card's meta line as segments: genre · origin · date, furigana included. */
export function storyCardMetaRuby(story: Story, lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE): RubyText {
  const genre = genreRuby(story.genre, lang);
  const head = genre.length > 0 ? genre : translate(lang, "story.noGenre");
  return [
    ...head,
    { text: " · " },
    ...originRuby(story, lang),
    { text: " · " },
    ...storyDateRuby(story.createdAt, lang),
  ];
}

const STAGE_STRINGS = {
  preparing: "stage.preparing",
  writing: "stage.writing",
  checking: "stage.checking",
  saving: "stage.saving",
} as const;

/**
 * The table entry naming a run's stage. Screens that render copy through <T>
 * use this with progressStageParams so the visible line keeps its furigana
 * (issue #125); stageLabel stays the plain-text form for aria labels.
 */
export function progressStageKey(progress: StoryGenerationProgress): StringKey {
  const key = STAGE_STRINGS[progress.stage as keyof typeof STAGE_STRINGS];
  if (key === undefined) return "stage.writing";
  if (progress.stage === "writing" && progress.attempt != null && progress.maxAttempts != null) {
    return "stage.writingAttempt";
  }
  return key;
}

/** The {placeholders} progressStageKey's entry fills; empty for the plain stages. */
export function progressStageParams(progress: StoryGenerationProgress): TranslateParams {
  if (progressStageKey(progress) === "stage.writingAttempt") {
    return { attempt: progress.attempt ?? 1, max: progress.maxAttempts ?? 1 };
  }
  return {};
}

/** The Learner-facing stage of a generation run, in every place a run shows progress. */
export function stageLabel(
  progress: StoryGenerationProgress,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return translatePlain(lang, progressStageKey(progress), progressStageParams(progress));
}

/** The progress line a run shows: its stage and the rounded percent. */
export function progressLabel(
  progress: StoryGenerationProgress,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): string {
  return `${stageLabel(progress, lang)} ${Math.round(progress.percent ?? 0)}%`;
}
