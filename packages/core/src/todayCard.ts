import type { Story, StoryGenerationProgress } from "@vjt/api-client";
import { DEFAULT_INTERFACE_LANGUAGE, type InterfaceLanguage } from "./i18n/language.ts";
import { translatePlain } from "./i18n/translate.ts";
import type { StoryGenerationState } from "./useStoryGeneration.ts";
import type { TodaysStoryState } from "./useStory.ts";

/**
 * Which state Today's Story card shows (plan 4.4 item 2, issue #71). Both apps
 * render the pinned card from the same decision, so the cascade lives here and
 * each app only chooses the words and the controls:
 *
 *   loading → story → running → error → failed → empty
 *
 * A Story on screen wins over a run in progress (the run is then "a newer
 * Story is being written", which the card reports alongside the Story). A
 * failed run comes after a failed read, and a run in progress wins over both.
 */
export type TodayCardPhase =
  | { kind: "loading" }
  | {
      kind: "story";
      story: Story;
      /** The progress of a run in flight, which is for a newer Story than this one; null when idle. */
      running: StoryGenerationProgress | null;
    }
  | { kind: "running"; progress: StoryGenerationProgress }
  | { kind: "error"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "empty" };

/** What a failed run says when the server gave no words of its own. */
export const FAILED_RUN_FALLBACK = translatePlain("en", "story.runFailed");

export function todayCardPhase(
  today: TodaysStoryState,
  generation: StoryGenerationState,
  lang: InterfaceLanguage = DEFAULT_INTERFACE_LANGUAGE,
): TodayCardPhase {
  const running = generation.status === "running" ? generation.progress : null;
  if (today.status === "loading") return { kind: "loading" };
  if (today.status === "story") return { kind: "story", story: today.story, running };
  if (running) return { kind: "running", progress: running };
  if (today.status === "error") return { kind: "error", message: today.message };
  if (generation.status === "failed") {
    return {
      kind: "failed",
      message: generation.progress.message ?? translatePlain(lang, "story.runFailed"),
    };
  }
  return { kind: "empty" };
}
