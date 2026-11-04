import type { ApiClient, MaruMoriSyncRun, Story, StoryGenerationProgress } from "@vjt/api-client";
import {
  useFocusSet,
  useMarumori,
  useStoryGeneration,
  useStorySettings,
  useTodaysStory,
  type FocusSetView,
  type MaruMori,
  type StoryGenerationState,
  type TodaysStoryState,
} from "@vjt/core";
import { CONTENT_MAX_WIDTH, SIDEBAR_BREAKPOINT } from "./chrome/Shell.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { createFocusLabelResolver, FocusSetPanel, FOCUS_CHIPS_MAX } from "./components/ui/FocusSetPanel.tsx";
import { EmptyState, InlineError, ProgressBar, SkeletonBar } from "./state/states.tsx";

/**
 * Today (issue #47), the signed-in landing screen on Android and web. Plan 4.4
 * top to bottom: greeting with the date in the Learner's Timezone, Today's
 * Story card, the Practice call to action, the Focus Set at a glance, and the
 * Last Sync line. On wide screens (the same 1024 px the chrome switches at) the
 * Story card and the Practice CTA sit side by side.
 *
 * Every section carries its own loading, empty and error state (plan §5): one
 * section failing never blanks the rest, and each failure retries in place.
 *
 * Styling is design-token classes only (plan §3): no palette colours, no inline
 * font sizes.
 */

/**
 * The screen reads five things and acts on three of them, all through the
 * router by the caller (`app/index.tsx`): opening a Story, starting Practice,
 * the Stories list (where generation is configured) and the MaruMori settings
 * section. Keeping them as props keeps the screen testable without a router.
 */
export function Today({
  client,
  onOpenStory,
  onOpenPractice,
  onOpenStories,
  onOpenWordLists,
  onOpenMarumoriSettings,
}: {
  client: ApiClient;
  onOpenStory: (storyId: string) => void;
  onOpenPractice: () => void;
  onOpenStories: () => void;
  onOpenWordLists: () => void;
  onOpenMarumoriSettings: () => void;
}) {
  const today = useTodaysStory(client);
  const { settings: learnerSettings } = useStorySettings(client);
  const generation = useStoryGeneration(client);
  const focus = useFocusSet(client);
  const marumori = useMarumori(client);
  const { width } = useWindowDimensions();
  const wide = width >= SIDEBAR_BREAKPOINT;

  // The Learner's Timezone (plan 4.4 item 1): it decides the greeting, the
  // date, and the clock time on the Last Sync line. Unset means the server's
  // own zone, so the device's zone is the closest thing we have to that.
  const timezone = learnerSettings.status === "ready" ? learnerSettings.settings.timezone : undefined;

  // Chip labels for the Focus Set glance (issue #47 review B1): created once
  // per client so the panel's lookup cache keys stay stable across renders.
  const resolveChipLabel = useMemo(() => createFocusLabelResolver(client), [client]);

  // A run that finishes while the Learner is looking at Today lands in the
  // card without a reload. Only the transition counts: the server keeps the
  // last finished snapshot for a while, and re-reading on mount would ask for
  // Today's Story twice for nothing.
  const sawRunning = useRef(false);
  const { reloadToday } = today;
  useEffect(() => {
    if (generation.generation.status === "running") sawRunning.current = true;
    else if (generation.generation.status === "ready" && sawRunning.current) {
      sawRunning.current = false;
      reloadToday();
    }
  }, [generation.generation.status, reloadToday]);

  return (
    <ScrollView className="flex-1" accessibilityLabel="Today" contentContainerStyle={styles.page}>
      <View className="w-full gap-4" style={styles.column}>
        <Greeting
          timezone={timezone}
          settingsPending={learnerSettings.status === "loading"}
          settingsFailed={learnerSettings.status === "error"}
        />

        <View className={wide ? "flex-row items-stretch gap-4" : "gap-4"}>
          <View className={wide ? "flex-1" : undefined}>
            <TodayStoryCard
              today={today.today}
              generation={generation.generation}
              onReloadToday={reloadToday}
              onOpenStory={onOpenStory}
              onOpenStories={onOpenStories}
              fill={wide}
            />
          </View>
          <View className={wide ? "flex-1" : undefined}>
            <PracticeCard focus={focus} onOpenPractice={onOpenPractice} fill={wide} />
          </View>
        </View>

        <Card>
          <FocusSetPanel
            focus={focus}
            client={client}
            resolveLabel={resolveChipLabel}
            max={FOCUS_CHIPS_MAX}
            onOpenWordLists={onOpenWordLists}
          />
        </Card>

        <SyncCard
          marumori={marumori}
          timezone={timezone}
          onOpenMarumoriSettings={onOpenMarumoriSettings}
        />
      </View>
    </ScrollView>
  );
}

/**
 * Greeting plus the date, both read in the Learner's Timezone. While the
 * settings read is still in flight the block holds a skeleton rather than
 * showing the device's clock first: a Learner whose zone is different would
 * watch their greeting and date change under them (issue #47 review S2). A
 * settings read that failed still shows a greeting and date (in the device's
 * zone) with a quiet note: the clock is not the part worth interrupting the
 * Learner over.
 */
function Greeting({
  timezone,
  settingsPending,
  settingsFailed,
}: {
  timezone: string | undefined | null;
  settingsPending: boolean;
  settingsFailed: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // One tick a minute keeps the greeting honest across a morning scroll
    // without re-rendering the whole screen off a shared clock.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const clock = learnerClock(now, timezone);
  return (
    <View className="mb-1 gap-1" testID="today-greeting">
      {settingsPending ? (
        // Same shape as the settled greeting: a display-size bar and a
        // smaller date bar (issue #47 review S7).
        <View className="gap-2 py-1">
          <SkeletonBar width={180} height={30} />
          <SkeletonBar width={140} height={16} />
        </View>
      ) : (
        <>
          {/* Section labels read as headings to assistive tech on both hosts:
              accessibilityRole on native, role on web (issue #47 review S4). */}
          <Text
            role="heading"
            accessibilityRole="header"
            className="text-display font-semibold text-foreground"
          >
            {clock.greeting}
          </Text>
          <Text className="text-body text-muted-foreground">{clock.date}</Text>
          {settingsFailed ? (
            <Text className="text-small text-muted-foreground">
              Timezone unavailable — showing your device's time.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * The Learner's greeting and date, from the Learner's Timezone rather than the
 * device's: a Learner in Osaka opening the app at 07:30 sees "Good morning" and
 * their own Wednesday even when the phone or browser is set elsewhere. An empty
 * or unknown zone name means the server's rule too — unset Timezone is
 * "the server's own day", so the device's zone stands in for it.
 */
export function learnerClock(
  now: Date,
  timezone: string | undefined | null,
): { greeting: string; date: string } {
  const zone = normalizeTimezone(timezone);
  const parts = readParts(now, zone, ["hour", "weekday", "month", "day"]);
  const hour = parts.hour ?? String(now.getHours());
  const weekday = parts.weekday ?? now.toLocaleDateString(undefined, { weekday: "long" });
  const month = parts.month ?? "";
  const day = parts.day ?? String(now.getDate());
  return { greeting: greetingFor(hour), date: `${weekday}, ${month} ${day}` };
}

/** An IANA name the runtime can load, or undefined to follow the device. */
function normalizeTimezone(timezone: string | undefined | null): string | undefined {
  if (!timezone) return undefined;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
}

/** The pieces of the instant, in the zone, without trusting a locale's order. */
function readParts(
  now: Date,
  zone: string | undefined,
  want: Intl.DateTimeFormatPartTypes[],
): Partial<Record<Intl.DateTimeFormatPartTypes, string>> {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const out: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
    for (const part of parts) {
      if (want.includes(part.type)) out[part.type] = part.type === "hour" ? part.value.padStart(2, "0") : part.value;
    }
    return out;
  } catch {
    return {};
  }
}

/** The day's three greetings; the small hours get their own, since learners keep odd hours. */
function greetingFor(hourText: string): string {
  // Some engines hand back "24" for midnight under hour12: false.
  const hour = Number.parseInt(hourText, 10) % 24;
  if (Number.isNaN(hour)) return "Hello";
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  if (hour >= 18 && hour < 22) return "Good evening";
  return "Still studying";
}

/**
 * Today's Story card (plan 4.4 item 2): the title, its Genre and length and an
 * Open button — or, while a Story is being written, the progress of that run.
 */
function TodayStoryCard({
  today,
  generation,
  onReloadToday,
  onOpenStory,
  onOpenStories,
  fill,
}: {
  today: TodaysStoryState;
  generation: StoryGenerationState;
  onReloadToday: () => void;
  onOpenStory: (storyId: string) => void;
  onOpenStories: () => void;
  fill: boolean;
}) {
  const running = generation.status === "running" ? generation.progress : undefined;
  return (
    <Card testID="today-story-card" fill={fill}>
      <Text
        role="heading"
        accessibilityRole="header"
        className="text-title-sm font-semibold text-foreground"
      >
        Today’s Story
      </Text>

      {today.status === "loading" ? (
        // Shaped like the settled card: a story-title bar, a shorter meta
        // line, and the button block (issue #47 review S7) - so nothing
        // jumps when the story lands.
        <View className="gap-3">
          <SkeletonBar width="70%" height={24} />
          <SkeletonBar width="45%" height={14} />
          <SkeletonBar width={96} height={44} />
        </View>
      ) : today.status === "story" ? (
        <View className="gap-3">
          <Text className="text-title font-semibold text-foreground">{today.story.title}</Text>
          <Text className="text-small text-muted-foreground">{storyMeta(today.story)}</Text>
          <ActionButton
            label="Open"
            accessibilityLabel="Open today's story"
            onPress={() => onOpenStory(today.story.id)}
            filled
            testID="today-story-open"
          />
          {/* A run started from Stories keeps its bar there; the card only says
              the story on screen is not the newest thing happening. */}
          {generation.status === "running" ? (
            <Text className="text-caption text-muted-foreground">
              A newer Story is being written.
            </Text>
          ) : null}
        </View>
      ) : running ? (
        <View className="gap-3">
          <Text className="text-body text-muted-foreground">
            A new Story is on its way — you can leave and come back.
          </Text>
          <ProgressBar
            value={(running.percent ?? 0) / 100}
            label={`${stageLabel(running)} ${Math.round(running.percent ?? 0)}%`}
          />
        </View>
      ) : today.status === "error" ? (
        <InlineError message={`Cannot load today’s Story: ${today.message}`} onRetry={onReloadToday} />
      ) : generation.status === "failed" ? (
        // The run failed rather than the read: the line is the server's own,
        // and the way to try again is the Generate box on Stories.
        <View className="gap-3">
          <Text className="text-body text-destructive">
            {generation.progress?.message ?? "Couldn’t write a Story for you."}
          </Text>
          <ActionButton label="Generate a Story" onPress={onOpenStories} />
        </View>
      ) : (
        <EmptyState
          compact
          message="No Story yet — the tutor writes one for you every day."
          actionLabel="Generate a Story"
          onAction={onOpenStories}
        />
      )}
    </Card>
  );
}

/** Genre and length (plan 4.4 item 2). The API has no length field, so the
 * sentence count is what the Story actually reports — see the issue #47 notes.
 * A story with no genre says only the length: "no genre · " is noise the
 * Learner cannot act on (issue #47 review N1). */
function storyMeta(story: Story): string {
  const sentences = story.sentences?.length ?? 0;
  const length = `${sentences} sentence${sentences === 1 ? "" : "s"}`;
  const genre = story.genre?.trim();
  return genre ? `${genre} · ${length}` : length;
}

/** The generation stage in Learner's words, same as the Stories screen's. */
function stageLabel(progress: StoryGenerationProgress): string {
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

/**
 * The Practice call to action (plan 4.4 item 3): how many Focus Set items are
 * waiting, and one Start button.
 */
function PracticeCard({
  focus,
  onOpenPractice,
  fill,
}: {
  focus: FocusSetView;
  onOpenPractice: () => void;
  fill: boolean;
}) {
  const items = focus.items;
  return (
    <Card testID="today-practice-card" fill={fill}>
      <Text
        role="heading"
        accessibilityRole="header"
        className="text-title-sm font-semibold text-foreground"
      >
        Practice
      </Text>
      {focus.loading && items === null ? (
        // Shaped like the settled card: the waiting line and the Start button
        // block (issue #47 review S7).
        <View className="gap-3">
          <SkeletonBar width="55%" height={20} />
          <SkeletonBar width={96} height={44} />
        </View>
      ) : focus.error ? (
        <InlineError message={focus.error} onRetry={focus.retry} />
      ) : (
        <View className="gap-3">
          <Text className="text-body text-muted-foreground">
            {waitingLine(items?.length ?? 0)}
          </Text>
          <ActionButton
            label="Start"
            accessibilityLabel="Start practice"
            accessibilityHint={
              items && items.length > 0
                ? `Builds a session from ${items.length} Focus Set item${items.length === 1 ? "" : "s"}`
                : undefined
            }
            onPress={onOpenPractice}
            filled
            testID="today-practice-start"
          />
          {items?.length === 0 ? (
            <Text className="text-caption text-muted-foreground">
              A session is built from your Focus Set, so there is nothing to practise until a Sync
              or a Story adds items.
            </Text>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function waitingLine(count: number): string {
  if (count === 0) return "Nothing is waiting in your Focus Set yet.";
  return `${count} Focus Set item${count === 1 ? "" : "s"} waiting.`;
}

/**
 * Last Sync (plan 4.4 item 5): when the last run finished, what it found, and a
 * Sync now. A failure that is still the newest news (the server's `lastFailure`)
 * is what the line reports, in destructive, with the same way out as the
 * Settings section.
 */
function SyncCard({
  marumori,
  timezone,
  onOpenMarumoriSettings,
}: {
  marumori: MaruMori;
  timezone: string | undefined | null;
  onOpenMarumoriSettings: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const syncNow = () => {
    setSyncing(true);
    setSyncNote(null);
    void marumori.sync().then((outcome) => {
      setSyncing(false);
      if ("status" in outcome && outcome.status === "error") {
        // The call itself failed (network, auth): the hook's own words.
        setSyncNote(outcome.message);
      } else if (outcome.status === "failed") {
        // The run ran and failed: the server's Learner-facing reason, which
        // is more useful than anything the screen could invent (issue #47
        // review S1).
        setSyncNote(outcome.error ?? "Sync failed.");
      } else {
        // sync() already re-read the status on success, so the Last Sync line
        // under this note is the fresh one without a second reload (S3).
        setSyncNote("Sync succeeded.");
      }
    });
  };

  return (
    <Card testID="today-sync-card">
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text
          role="heading"
          accessibilityRole="header"
          className="text-title-sm font-semibold text-foreground"
        >
          Last sync
        </Text>
        <ActionButton
          label={syncing ? "Syncing…" : "Sync now"}
          onPress={syncNow}
          disabled={syncing || marumori.state.status !== "ready" || !isConnected(marumori)}
          testID="today-sync-now"
        />
      </View>

      {marumori.state.status === "loading" ? (
        // Shaped like the settled Last Sync line: a timestamp line and the
        // shorter counts line (issue #47 review S7).
        <View className="gap-2">
          <SkeletonBar width="60%" height={20} />
          <SkeletonBar width="80%" height={14} />
        </View>
      ) : marumori.state.status === "error" ? (
        <InlineError message={marumori.state.message} onRetry={marumori.reload} />
      ) : !isConnected(marumori) ? (
        <View className="gap-3">
          <Text className="text-body text-muted-foreground">
            No MaruMori account linked yet, so nothing has been synced.
          </Text>
          <ActionButton label="Link MaruMori" onPress={onOpenMarumoriSettings} />
        </View>
      ) : (
        <SyncLine marumori={marumori} timezone={timezone} />
      )}
      {syncNote ? (
        <Text accessibilityLiveRegion="polite" role="status" className="text-caption text-muted-foreground">
          {syncNote}
        </Text>
      ) : null}
    </Card>
  );
}

function isConnected(marumori: MaruMori): boolean {
  return marumori.state.status === "ready" && marumori.state.marumori.connected;
}

function SyncLine({
  marumori,
  timezone,
}: {
  marumori: MaruMori;
  timezone: string | undefined | null;
}) {
  if (marumori.state.status !== "ready") return null;
  const { lastSync, lastFailure } = marumori.state.marumori;
  // lastFailure is only set while it is the newest news, so whichever of the two
  // is later is the story to tell.
  const failed =
    lastFailure && (!lastSync || newer(lastFailure.startedAt, lastSync.startedAt))
      ? lastFailure
      : undefined;
  if (failed) {
    return (
      <View className="gap-2">
        <Text className="text-body text-destructive">
          {`Last sync failed ${formatInstant(failed.finishedAt ?? failed.startedAt, timezone)}.`}
        </Text>
        {failed.error ? <Text className="text-small text-muted-foreground">{failed.error}</Text> : null}
      </View>
    );
  }
  if (!lastSync) {
    return (
      <Text className="text-body text-muted-foreground">
        No sync has finished yet. Press Sync now to pull your knowledge across.
      </Text>
    );
  }
  return (
    <View className="gap-2">
      {/* Explicit about what the timestamp is (issue #47 review polish): a
          bare clock time does not read as "this sync worked". */}
      <Text className="text-body text-foreground">
        {`Last sync succeeded ${formatInstant(lastSync.finishedAt ?? lastSync.startedAt, timezone)}.`}
      </Text>
      <Text className="text-small text-muted-foreground">{syncResultLine(lastSync)}</Text>
    </View>
  );
}

function newer(a: string, b: string): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}

function syncResultLine(run: MaruMoriSyncRun): string {
  const counts = run.counts;
  if (!counts) return "The sync finished with no counts to report.";
  return `${counts.new} new item${counts.new === 1 ? "" : "s"}, ${counts.levelChanges} level change${
    counts.levelChanges === 1 ? "" : "s"
  }, ${counts.linked} linked to reference data.`;
}

/**
 * An instant in the Learner's Timezone — "November 4, 14:02". A bad zone name
 * falls back to the device's, the same rule the greeting uses.
 */
export function formatInstant(iso: string, timezone: string | undefined | null): string {
  const zone = normalizeTimezone(timezone);
  const parts = readParts(new Date(iso), zone, ["month", "day", "hour", "minute"]);
  if (!parts.month || !parts.day || !parts.hour || !parts.minute) return new Date(iso).toLocaleString();
  return `${parts.month} ${parts.day}, ${parts.hour}:${parts.minute}`;
}

/**
 * The one action control a section offers: 44 px tall and 8 px of radius like
 * every other button (plan 2.5), filled where the section's main action is and
 * outlined where it is a way out.
 */
function ActionButton({
  label,
  onPress,
  filled = false,
  disabled = false,
  testID,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  filled?: boolean;
  disabled?: boolean;
  testID?: string;
  /** Screen-reader name when the visible text alone is too terse (S4). */
  accessibilityLabel?: string;
  /** Screen-reader hint on what pressing does, e.g. how many items feed it. */
  accessibilityHint?: string;
}) {
  const shape = filled ? "bg-primary" : "border border-border bg-card";
  const text = filled ? "text-primary-foreground" : "text-foreground";
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 flex-row items-center justify-center self-start rounded-md px-4 active:opacity-80 ${shape}${
        disabled ? " opacity-50" : ""
      }`}
    >
      {/* uniwind drops a colour class that precedes a text-size class on native,
          so the size comes first here as everywhere else. */}
      <Text className={`text-body font-semibold ${text}`}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // paddingTop matches Practice's card column (24), so the first card sits at
  // the same height on either screen. Top safe-area insets are the Shell's
  // job, not this screen's - follow-up filed as a Shell issue (the greeting
  // can sit under the Android status bar until that lands).
  page: { flexGrow: 1, padding: 16, paddingTop: 24 },
  // The Shell caps the column on wide screens; Today only keeps the narrow
  // reading measure when the chrome has no sidebar to do it.
  column: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, gap: 16 },
});
