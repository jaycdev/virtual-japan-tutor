// The progress line of a Story generation run: a bar and the stage sentence.
// The stage comes from the string table through <T> so it carries furigana in
// ja-furigana (issue #125 review B3); the bar's aria-label is the same sentence
// in plain text, because an attribute can't hold ruby markup. The rounded
// percent follows the stage word, and the bar already announces it through
// aria-valuenow.
import type { StoryGenerationProgress } from "@vjt/api-client";
import { progressLabel, progressStageKey, progressStageParams, type InterfaceLanguage } from "@vjt/core";

import { T } from "@/components/Text.tsx";
import { ProgressStatus } from "@/components/states";

export function StoryProgress({
  progress,
  language,
}: {
  progress: StoryGenerationProgress;
  language: InterfaceLanguage;
}) {
  const percent = Math.round(progress.percent ?? 0);
  return (
    <ProgressStatus
      value={(progress.percent ?? 0) / 100}
      label={
        <>
          <T k={progressStageKey(progress)} params={progressStageParams(progress)} /> {percent}%
        </>
      }
      ariaLabel={progressLabel(progress, language)}
    />
  );
}
