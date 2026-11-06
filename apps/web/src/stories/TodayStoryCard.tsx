// Today's Story, pinned (plan 4.4 item 2 and 4.5). One card for both pages: the
// Today page and the Stories page show the same state cascade (@vjt/core's
// todayCardPhase, issue #71) and differ only in the words and the actions the
// card offers, set by `variant`.
import type { Story } from "@vjt/api-client";
import {
  progressLabel,
  stillUnreadFrom,
  storyCardMeta,
  todayCardPhase,
  useT,
  type StoryGenerationState,
  type TodaysStoryState,
} from "@vjt/core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, ProgressStatus } from "@/components/states";
import { T } from "@/components/Text.tsx";

export interface TodayStoryCardProps {
  today: TodaysStoryState;
  generation: StoryGenerationState;
  /** The instant the card is read at, for the "still unread" hint. */
  now: Date;
  timezone: string | undefined;
  /** "today": the Today page, whose actions point at Stories. "stories": the pinned card on Stories, whose actions act here. */
  variant: "today" | "stories";
  onReloadToday: () => void;
  /** Stories only: starts the Generate dialog from the failed or empty states. */
  onGenerate?: () => void;
  /** Stories only: the Story a run started from this page just wrote, until it is opened. */
  readyStoryId?: string | null;
  /** Stories only: spends the "Ready, read now" offer once the Story is opened. */
  onOpenReady?: () => void;
}

export function TodayStoryCard({
  today,
  generation,
  now,
  timezone,
  variant,
  onReloadToday,
  onGenerate,
  readyStoryId = null,
  onOpenReady,
}: TodayStoryCardProps) {
  const { tp, language } = useT();
  const phase = todayCardPhase(today, generation);
  // The finished run's Story is worth opening even before the reload lands it;
  // once Today shows it, the card's own Open is the same action.
  const justWritten = readyStoryId !== null && (phase.kind !== "story" || phase.story.id !== readyStoryId);

  return (
    <Card
      className={
        phase.kind === "story"
          // The Story phase wears a stretched link from its Open button across
          // the whole card (plan 4.5): the card is the way in, so it lights up
          // like one. Other phases have no link to stretch.
          ? "relative gap-4 px-6 transition-shadow hover:shadow-md focus-within:shadow-md"
          : "gap-4 px-6"
      }
      aria-labelledby="today-story-heading"
      data-testid="today-story-card"
    >
      <h2 id="today-story-heading" className="text-title-sm font-semibold text-foreground">
        <T k="today.storyHeading" />
      </h2>


      {phase.kind === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <Skeleton className="h-6 w-[70%]" />
          <Skeleton className="h-3.5 w-[45%]" />
          <Skeleton className="h-11 w-24" />
        </div>
      ) : phase.kind === "story" ? (
        <StoryBody
          story={phase.story}
          unreadFrom={stillUnreadFrom(phase.story, now, timezone, language)}
          running={phase.running ? progressLabel(phase.running, language) : null}
          runningValue={phase.running ? (phase.running.percent ?? 0) / 100 : 0}
          justWritten={justWritten ? readyStoryId : null}
          onOpenReady={onOpenReady}
        />
      ) : phase.kind === "running" ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-muted-foreground">
            <T k="today.storyGenerating" />
          </p>
          <ProgressStatus
            value={(phase.progress.percent ?? 0) / 100}
            label={progressLabel(phase.progress, language)}
          />
        </div>
      ) : phase.kind === "error" ? (
        <ErrorState
          message={tp("today.storyError", { message: phase.message })}
          onRetry={onReloadToday}
        />
      ) : phase.kind === "failed" ? (
        // The run failed, not the read: the server's own words, and the way to try again.
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-body text-destructive">
            {phase.message}
          </p>
          {variant === "today" ? (
            <Button asChild variant="outline">
              <Link to="/stories">
                <T k="today.storyGenerate" />
              </Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={onGenerate}>
              <T k="today.storyRetry" />
            </Button>
          )}
        </div>
      ) : variant === "today" ? (
        <EmptyState
          compact
          message={tp("today.storyEmptyToday")}
          action={
            <Button asChild variant="outline">
              <Link to="/stories">
                <T k="today.storyGenerate" />
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-muted-foreground">
            <T k="today.storyEmptyStories" />
          </p>
          <Button variant="outline" onClick={onReloadToday}>
            <T k="today.storyCheckAgain" />
          </Button>
        </div>
      )}
    </Card>
  );
}

function StoryBody({
  story,
  unreadFrom,
  running,
  runningValue,
  justWritten,
  onOpenReady,
}: {
  story: Story;
  unreadFrom: string | null;
  /** The label of a run in flight, which is for a newer Story than this one. */
  running: string | null;
  runningValue: number;
  justWritten: string | null;
  onOpenReady?: () => void;
}) {
  const { tp, language } = useT();
  return (
    <div className="flex flex-col gap-3">
      <p lang="ja" className="text-title font-semibold text-foreground">
        {story.title}
      </p>
      <p className="text-small text-muted-foreground">{storyCardMeta(story, language)}</p>
      {unreadFrom ? (
        <p className="text-small text-muted-foreground">
          <T k="today.storyStillUnread" params={{ date: unreadFrom }} />
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link
            to={`/stories/${story.id}`}
            aria-label={tp(
              story.readAt ? "today.storyAriaReadAgain" : "today.storyAriaOpen",
              { title: story.title },
            )}
            className="after:absolute after:inset-0 after:content-['']"
          >
            <T k={story.readAt ? "today.storyReadAgain" : "today.storyOpen"} />
          </Link>
        </Button>
        {justWritten ? (
          // Above the stretched Open link, so this deliberate choice keeps its
          // own click: it goes to the just-written Story, not the one on card.
          <Button asChild variant="outline" className="relative z-10">
            <Link to={`/stories/${justWritten}`} onClick={onOpenReady}>
              <T k="today.storyReadyNow" />
            </Link>
          </Button>
        ) : null}
      </div>
      {running ? (
        // A run started from Stories keeps its bar there; the card only says the
        // Story on screen is not the newest thing happening.
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">
            <T k="today.storyNewerWriting" />
          </p>
          <ProgressStatus value={runningValue} label={running} />
        </div>
      ) : null}
    </div>
  );
}
