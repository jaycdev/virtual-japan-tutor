// Today (plan 4.4, issue #79): the signed-in landing page. Top to bottom: the
// greeting and date in the Learner's Timezone; Today's Story card beside the
// Practice call to action (side by side from 1024 px); the Focus Set at a glance;
// and the Last Sync line. Every section has its own loading, empty and error
// state, so one section failing never blanks the rest.
import type { ApiClient } from "@vjt/api-client";
import {
  learnerClockRuby,
  useFocusSet,
  useMarumori,
  useStoryGeneration,
  useStorySettings,
  useT,
  useTodaysStory,
} from "@vjt/core";
import { useEffect, useRef } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { T, TableText } from "@/components/Text.tsx";
import { useMinuteClock } from "@/lib/useMinuteClock.ts";
import { TodayStoryCard } from "../stories/TodayStoryCard.tsx";
import { FocusGlance } from "./FocusGlance.tsx";
import { PracticeCard } from "./PracticeCard.tsx";
import { SyncCard } from "./SyncCard.tsx";

export function Today({ client }: { client: ApiClient }) {
  const today = useTodaysStory(client);
  const { settings } = useStorySettings(client);
  const generation = useStoryGeneration(client);
  const focus = useFocusSet(client);
  const marumori = useMarumori(client);
  const now = useMinuteClock();

  // The Learner's Timezone (plan 4.4 item 1): it decides the greeting, the date,
  // the "still unread" day and the clock time on the Last Sync line. Unset means
  // the server's own zone, so the browser's zone stands in for it.
  const timezone = settings.status === "ready" ? settings.settings.timezone : undefined;

  // A run that finishes while the Learner is looking at Today lands in the card
  // without a reload. Only the transition counts: the server keeps the last
  // finished snapshot for a while, and re-reading on mount would ask twice.
  const sawRunning = useRef(false);
  const { reloadToday } = today;
  const runStatus = generation.generation.status;
  useEffect(() => {
    if (runStatus === "running") sawRunning.current = true;
    else if (runStatus === "ready" && sawRunning.current) {
      sawRunning.current = false;
      reloadToday();
    }
  }, [runStatus, reloadToday]);

  return (
    <div className="flex flex-col gap-6" data-testid="today">
      <Greeting now={now} timezone={timezone} settingsPending={settings.status === "loading"} settingsFailed={settings.status === "error"} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TodayStoryCard
          variant="today"
          today={today.today}
          generation={generation.generation}
          now={now}
          timezone={timezone}
          onReloadToday={reloadToday}
        />
        <PracticeCard focus={focus} />
      </div>

      <FocusGlance client={client} focus={focus} />

      <SyncCard marumori={marumori} timezone={timezone} />
    </div>
  );
}

/**
 * The greeting and the date (plan 4.4 item 1). While the settings read is still
 * in flight the block holds a skeleton rather than the browser's clock: a Learner
 * in another zone would watch both change under them. A failed settings read
 * still shows the greeting, in the browser's zone, with a quiet note.
 */
function Greeting({
  now,
  timezone,
  settingsPending,
  settingsFailed,
}: {
  now: Date;
  timezone: string | undefined;
  settingsPending: boolean;
  settingsFailed: boolean;
}) {
  const { language } = useT();
  if (settingsPending) {
    return (
      <div className="flex flex-col gap-2 py-1" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-36" />
      </div>
    );
  }
  const clock = learnerClockRuby(now, timezone, language);
  return (
    <header className="flex flex-col gap-1">
      {/* Greeting and date both go through the table as segments, so in
          ja-furigana the date's kanji — 年月日 and the weekday — carries its
          reading like every other piece of chrome (#125 round-2 review
          coverage, round-3 review S3). learnerClock's plain strings would
          drop it. */}
      <h1 className="text-display font-semibold text-foreground">
        <TableText segments={clock.greeting} />
      </h1>
      <p className="text-body text-muted-foreground">
        <TableText segments={clock.date} />
      </p>
      {settingsFailed ? (
        <p className="text-small text-muted-foreground">
          <T k="today.timezoneUnavailable" />
        </p>
      ) : null}
    </header>
  );
}
