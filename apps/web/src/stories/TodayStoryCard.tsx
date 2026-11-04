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
  type StoryGenerationState,
  type TodaysStoryState,
} from "@vjt/core";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, ErrorState, ProgressStatus } from "@/components/states";

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
  const phase = todayCardPhase(today, generation);
  // The finished run's Story is worth opening even before the reload lands it;
  // once Today shows it, the card's own Open is the same action.
  const justWritten = readyStoryId !== null && (phase.kind !== "story" || phase.story.id !== readyStoryId);

  return (
    <Card className="gap-4 px-6" aria-labelledby="today-story-heading" data-testid="today-story-card">
      <h2 id="today-story-heading" className="text-title-sm font-semibold text-foreground">
        Today’s Story
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
          unreadFrom={stillUnreadFrom(phase.story, now, timezone)}
          running={phase.running ? progressLabel(phase.running) : null}
          runningValue={phase.running ? (phase.running.percent ?? 0) / 100 : 0}
          justWritten={justWritten ? readyStoryId : null}
          onOpenReady={onOpenReady}
        />
      ) : phase.kind === "running" ? (
        <div className="flex flex-col gap-3">
          <p className="text-body text-muted-foreground">A new Story is on its way — you can leave and come back.</p>
          <ProgressStatus value={(phase.progress.percent ?? 0) / 100} label={progressLabel(phase.progress)} />
        </div>
      ) : phase.kind === "error" ? (
        <ErrorState message={`Cannot load today’s Story: ${phase.message}`} onRetry={onReloadToday} />
      ) : phase.kind === "failed" ? (
        // The run failed, not the read: the server's own words, and the way to try again.
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-body text-destructive">
            {phase.message}
          </p>
          {variant === "today" ? (
            <Button asChild variant="outline">
              <Link to="/stories">Generate a Story</Link>
            </Button>
          ) : (
            <Button variant="outline" onClick={onGenerate}>
              Try again
            </Button>
          )}
        </div>
      ) : variant === "today" ? (
        <EmptyState
          compact
          message="No Story yet — the tutor writes one for you every day."
          action={
            <Button asChild variant="outline">
              <Link to="/stories">Generate a Story</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-body text-muted-foreground">No Story for today yet — the tutor writes one for you every day.</p>
          <Button variant="outline" onClick={onReloadToday}>
            Check again
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
  return (
    <div className="flex flex-col gap-3">
      <p lang="ja" className="text-title font-semibold text-foreground">
        {story.title}
      </p>
      <p className="text-small text-muted-foreground">{storyCardMeta(story)}</p>
      {unreadFrom ? <p className="text-small text-muted-foreground">{`Still unread from ${unreadFrom}.`}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to={`/stories/${story.id}`} aria-label={`${story.readAt ? "Read again" : "Open"} today’s Story: ${story.title}`}>
            {story.readAt ? "Read again" : "Open"}
          </Link>
        </Button>
        {justWritten ? (
          <Button asChild variant="outline">
            <Link to={`/stories/${justWritten}`} onClick={onOpenReady}>
              Ready, read now
            </Link>
          </Button>
        ) : null}
      </div>
      {running ? (
        // A run started from Stories keeps its bar there; the card only says the
        // Story on screen is not the newest thing happening.
        <div className="flex flex-col gap-2">
          <p className="text-caption text-muted-foreground">A newer Story is being written.</p>
          <ProgressStatus value={runningValue} label={running} />
        </div>
      ) : null}
    </div>
  );
}
