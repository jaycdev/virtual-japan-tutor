import type { Story, StoryGenerationProgress } from "@vjt/api-client";

/**
 * Story words in the Learner's language, shared by the Stories screens (issue
 * #79 moved these out of apps/mobile's stories-parts). Pure functions: the
 * apps own the markup, the wording lives here once.
 */

/** Story Origin in Learner's words. */
export function originLabel(story: Pick<Story, "origin">): string {
  return story.origin === "on_demand" ? "On demand" : "Automatic";
}

/** The api-client's genre ids in Learner's words; an unknown id shows as-is. */
export function genreLabel(genre: string | null | undefined): string {
  switch (genre) {
    case "diary":
      return "Diary";
    case "travel":
      return "Travel";
    case "mystery":
      return "Mystery";
    case null:
    case undefined:
      return "";
    default:
      return genre;
  }
}

/** The card's date, short and unambiguous: "Nov 1, 2026". */
export function storyDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * The Genre / Story Origin / date line of a Library card: "Diary · Automatic ·
 * Nov 1, 2026". A Story without a Genre says "Story" in its place.
 */
export function storyCardMeta(story: Story): string {
  return `${genreLabel(story.genre) || "Story"} · ${originLabel(story)} · ${storyDate(story.createdAt)}`;
}

/** The Learner-facing stage of a generation run, in every place a run shows progress. */
export function stageLabel(progress: StoryGenerationProgress): string {
  switch (progress.stage) {
    case "preparing":
      return "Preparing…";
    case "writing":
      return progress.attempt != null && progress.maxAttempts != null
        ? `Writing… attempt ${progress.attempt} of ${progress.maxAttempts}`
        : "Writing…";
    case "checking":
      return "Checking it fits your vocabulary…";
    case "saving":
      return "Saving…";
    default:
      return "Writing…";
  }
}

/** The progress line a run shows: its stage and the rounded percent. */
export function progressLabel(progress: StoryGenerationProgress): string {
  return `${stageLabel(progress)} ${Math.round(progress.percent ?? 0)}%`;
}
