import type { ApiClient, MaruMoriSyncRun, Story } from "@vjt/api-client";
import {
  createFocusLabelResolver,
  formatInstant,
  formatInstantRuby,
  learnerClock,
  learnerClockRuby,
  pluralEn,
  progressStageKey,
  progressStageParams,
  todayCardPhase,
  useFocusSet,
  useMarumori,
  useStoryGeneration,
  useStorySettings,
  useT,
  useTodaysStory,
  type FocusSetView,
  type InterfaceLanguage,
  type MaruMori,
  type RubyText,
  type StoryGenerationState,
  type TodaysStoryState,
} from "@vjt/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { T, TableText } from "./components/Text.tsx";
import { Card } from "./components/ui/Card.tsx";
import { FocusSetPanel, FOCUS_CHIPS_MAX } from "./components/ui/FocusSetPanel.tsx";
import { EmptyState, InlineError, ProgressBar, SkeletonBar } from "./state/states.tsx";

// The clock helpers moved to @vjt/core (issue #79); re-exported so this
// screen's importers keep their path.
export { formatInstant, learnerClock };

/**
 * Today (issue #47), the signed-in landing screen. Plan 4.4 top to bottom:
 * greeting with the date in the Learner's Timezone, Today's Story card, the
 * Practice call to action, the Focus Set at a glance, and the Last Sync line.
 * The cards stack in one column.
 *
 * Every section carries its own loading, empty and error state (plan §5): one
 * section failing never blanks the rest, and each failure retries in place.
 *
 * Styling is design-token classes only (plan §3): no palette colours, no inline
 * font sizes. Chrome speaks the Interface Language (issue #125); the Story's
 * own words never change.
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
  const { tp: plain } = useT();
  const today = useTodaysStory(client);
  const { settings: learnerSettings } = useStorySettings(client);
  const generation = useStoryGeneration(client);
  const focus = useFocusSet(client);
  const marumori = useMarumori(client);

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
    <ScrollView className="flex-1" accessibilityLabel={plain("nav.today")} contentContainerStyle={styles.page}>
      <View className="w-full gap-4" style={styles.column}>
        <Greeting
          timezone={timezone}
          settingsPending={learnerSettings.status === "loading"}
          settingsFailed={learnerSettings.status === "error"}
        />

        <TodayStoryCard
          today={today.today}
          generation={generation.generation}
          onReloadToday={reloadToday}
          onOpenStory={onOpenStory}
          onOpenStories={onOpenStories}
        />
        <PracticeCard focus={focus} onOpenPractice={onOpenPractice} />

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
  const { language } = useT();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // One tick a minute keeps the greeting honest across a morning scroll
    // without re-rendering the whole screen off a shared clock.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const clock = learnerClockRuby(now, timezone, language);
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
          {/* Section labels read as headings to assistive tech (issue #47 review S4). */}
          <TableText
            segments={clock.greeting}
            className="text-display font-semibold text-foreground"
            accessibilityRole="header"
          />
          <TableText segments={clock.date} className="text-body text-muted-foreground" />
          {settingsFailed ? (
            <T k="mobile.todayTzUnavailable" className="text-small text-muted-foreground" />
          ) : null}
        </>
      )}
    </View>
  );
}

/**
 * Today's Story card (plan 4.4 item 2): the title, its Genre and length and an
 * Open button — or, while a Story is being written, the progress of that run.
 * Which state shows is the shared cascade in @vjt/core (todayCardPhase, #71).
 */
function TodayStoryCard({
  today,
  generation,
  onReloadToday,
  onOpenStory,
  onOpenStories,
}: {
  today: TodaysStoryState;
  generation: StoryGenerationState;
  onReloadToday: () => void;
  onOpenStory: (storyId: string) => void;
  onOpenStories: () => void;
}) {
  const { t, tp, language } = useT();
  const phase = todayCardPhase(today, generation);
  return (
    <Card testID="today-story-card">
      <T
        k="today.storyHeading"
        className="text-title-sm font-semibold text-foreground"
        accessibilityRole="header"
      />

      {phase.kind === "loading" ? (
        // Shaped like the settled card: a story-title bar, a shorter meta
        // line, and the button block (issue #47 review S7) - so nothing
        // jumps when the story lands.
        <View className="gap-3">
          <SkeletonBar width="70%" height={24} />
          <SkeletonBar width="45%" height={14} />
          <SkeletonBar width={96} height={44} />
        </View>
      ) : phase.kind === "story" ? (
        <View className="gap-3">
          <Text className="text-title font-semibold text-foreground">{phase.story.title}</Text>
          <TableText
            segments={storyMetaSegments(t, phase.story, language)}
            className="text-small text-muted-foreground"
          />
          <ActionButton
            label={<T k="today.storyOpen" className="text-body font-semibold text-primary-foreground" />}
            accessibilityLabel={tp("mobile.storyAriaOpenToday")}
            onPress={() => onOpenStory(phase.story.id)}
            filled
            testID="today-story-open"
          />
          {/* A run started from Stories keeps its bar there; the card only says
              the story on screen is not the newest thing happening. */}
          {phase.running ? (
            <T k="today.storyNewerWriting" className="text-caption text-muted-foreground" />
          ) : null}
        </View>
      ) : phase.kind === "running" ? (
        <View className="gap-3">
          <T k="today.storyGenerating" className="text-body text-muted-foreground" />
          <ProgressBar
            value={(phase.progress.percent ?? 0) / 100}
            label={
              // One line, not two: the percent rides on the stage entry's own
              // segments so the row reads as a single sentence in every mode.
              <TableText
                segments={[
                  ...t(progressStageKey(phase.progress), progressStageParams(phase.progress)),
                  { text: ` ${Math.round(phase.progress.percent ?? 0)}%` },
                ]}
                className="text-caption text-muted-foreground"
              />
            }
          />
        </View>
      ) : phase.kind === "error" ? (
        <InlineError message={<T k="today.storyError" params={{ message: phase.message }} />} onRetry={onReloadToday} />
      ) : phase.kind === "failed" ? (
        // The run failed rather than the read: the line is the server's own,
        // and the way to try again is the Generate box on Stories.
        <View className="gap-3">
          <Text className="text-body text-destructive">{phase.message}</Text>
          <ActionButton
            label={<T k="today.storyGenerate" className="text-body font-semibold text-foreground" />}
            accessibilityLabel={tp("today.storyGenerate")}
            onPress={onOpenStories}
          />
        </View>
      ) : (
        <EmptyState
          compact
          message={<T k="today.storyEmptyToday" className="text-center text-body text-muted-foreground" />}
          actionLabel={<T k="today.storyGenerate" className="text-body font-semibold text-primary" />}
          onAction={onOpenStories}
        />
      )}
    </Card>
  );
}

/**
 * Genre and length (plan 4.4 item 2). The API has no length field, so the
 * sentence count is what the Story actually reports — see the issue #47 notes.
 * A story with no genre says only the length: "no genre · " is noise the
 * Learner cannot act on (issue #47 review N1). The count is the table's, in
 * the Learner's language; the Genre is the Learner's own words and never
 * translates.
 */
function storyMetaSegments(
  t: ReturnType<typeof useT>["t"],
  story: Story,
  language: InterfaceLanguage,
): RubyText {
  const sentences = story.sentences?.length ?? 0;
  const length = t("mobile.todayStoryLength", { count: sentences, plural: pluralEn(language, sentences) });
  const genre = story.genre?.trim();
  return genre ? [{ text: `${genre} · ` }, ...length] : length;
}

/**
 * The Practice call to action (plan 4.4 item 3): how many Focus Set items are
 * waiting, and one Start button.
 */
function PracticeCard({
  focus,
  onOpenPractice,
}: {
  focus: FocusSetView;
  onOpenPractice: () => void;
}) {
  const { tp, language } = useT();
  const items = focus.items;
  const count = items?.length ?? 0;
  return (
    <Card testID="today-practice-card">
      <T
        k="today.practiceHeading"
        className="text-title-sm font-semibold text-foreground"
        accessibilityRole="header"
      />
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
          {count === 0 ? (
            <T k="today.practiceWaitingNone" className="text-body text-muted-foreground" />
          ) : (
            // English plural -s as a parameter; the Japanese column receives "" (issue #125).
            <T
              k="today.practiceWaitingCount"
              params={{ count, plural: pluralEn(language, count) }}
              className="text-body text-muted-foreground"
            />
          )}
          <ActionButton
            label={<T k="today.practiceStart" className="text-body font-semibold text-primary-foreground" />}
            accessibilityLabel={tp("today.practiceStartAria")}
            accessibilityHint={
              items && items.length > 0
                ? tp("mobile.todayPracticeHint", {
                    count: items.length,
                    plural: pluralEn(language, items.length),
                  })
                : undefined
            }
            onPress={onOpenPractice}
            filled
            testID="today-practice-start"
          />
          {items?.length === 0 ? (
            <T k="today.practiceSessionNote" className="text-caption text-muted-foreground" />
          ) : null}
        </View>
      )}
    </Card>
  );
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
  const { tp, language } = useT();
  const [syncing, setSyncing] = useState(false);
  // The note is a <T> element, not a resolved string: it stays in the Learner's
  // language if they switch while it is on screen (issue #125).
  const [syncNote, setSyncNote] = useState<ReactNode>(null);

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
        setSyncNote(outcome.error ?? <T k="today.syncFailedFallback" />);
      } else {
        // sync() already re-read the status on success, so the Last Sync line
        // under this note is the fresh one without a second reload (S3).
        setSyncNote(<T k="today.syncSucceededNote" />);
      }
    });
  };

  return (
    <Card testID="today-sync-card">
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <T
          k="today.lastSyncHeading"
          className="text-title-sm font-semibold text-foreground"
          accessibilityRole="header"
        />
        <ActionButton
          label={
            syncing ? (
              <T k="today.syncSyncing" className="text-body font-semibold text-foreground" />
            ) : (
              <T k="today.syncNow" className="text-body font-semibold text-foreground" />
            )
          }
          accessibilityLabel={tp(syncing ? "today.syncSyncing" : "today.syncNow")}
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
          <T k="today.syncNotLinked" className="text-body text-muted-foreground" />
          <ActionButton
            label={<T k="today.syncLinkMaruMori" className="text-body font-semibold text-foreground" />}
            accessibilityLabel={tp("today.syncLinkMaruMori")}
            onPress={onOpenMarumoriSettings}
          />
        </View>
      ) : (
        <SyncLine marumori={marumori} timezone={timezone} language={language} />
      )}
      {syncNote ? (
        typeof syncNote === "string" ? (
          <Text accessibilityLiveRegion="polite" role="status" className="text-caption text-muted-foreground">
            {syncNote}
          </Text>
        ) : (
          <View accessibilityLiveRegion="polite" role="status">
            {syncNote}
          </View>
        )
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
  language,
}: {
  marumori: MaruMori;
  timezone: string | undefined | null;
  language: InterfaceLanguage;
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
        <T
          k="today.syncFailedLine"
          params={{ time: formatInstantRuby(failed.finishedAt ?? failed.startedAt, timezone, language) }}
          className="text-body text-destructive"
        />
        {failed.error ? <Text className="text-small text-muted-foreground">{failed.error}</Text> : null}
      </View>
    );
  }
  if (!lastSync) {
    return <T k="today.syncNoneYet" className="text-body text-muted-foreground" />;
  }
  return (
    <View className="gap-2">
      {/* Explicit about what the timestamp is (issue #47 review polish): a
          bare clock time does not read as "this sync worked". */}
      <T
        k="today.syncSucceededLine"
        params={{ time: formatInstantRuby(lastSync.finishedAt ?? lastSync.startedAt, timezone, language) }}
        className="text-body text-foreground"
      />
      {syncResultLine(lastSync, language)}
    </View>
  );
}

function newer(a: string, b: string): boolean {
  return new Date(a).getTime() > new Date(b).getTime();
}

function syncResultLine(run: MaruMoriSyncRun, language: InterfaceLanguage): ReactNode {
  const counts = run.counts;
  if (!counts) return <T k="today.syncNoCounts" className="text-small text-muted-foreground" />;
  // The English column carries the plural -s as a parameter; the Japanese
  // column keeps the same placeholder and always receives "" (issue #125).
  return (
    <T
      k="today.syncResultCounts"
      params={{
        new: counts.new,
        newPlural: pluralEn(language, counts.new),
        levelChanges: counts.levelChanges,
        levelPlural: pluralEn(language, counts.levelChanges),
        linked: counts.linked,
      }}
      className="text-small text-muted-foreground"
    />
  );
}

/**
 * The one action control a section offers: 44 px tall and 8 px of radius like
 * every other button (plan 2.5), filled where the section's main action is and
 * outlined where it is a way out. A <T> label carries its own text classes
 * (issue #125), so those callers pass an explicit accessibilityLabel.
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
  label: ReactNode;
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
      accessibilityLabel={accessibilityLabel ?? (typeof label === "string" ? label : undefined)}
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
      {typeof label === "string" ? (
        <Text className={`text-body font-semibold ${text}`}>{label}</Text>
      ) : (
        label
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // paddingTop matches Practice's card column (24), so the first card sits at
  // the same height on either screen. The top safe-area inset is the Shell's
  // job (#60), so the greeting clears the Android status bar.
  page: { flexGrow: 1, padding: 16, paddingTop: 24 },
  column: { width: "100%", gap: 16 },
});
