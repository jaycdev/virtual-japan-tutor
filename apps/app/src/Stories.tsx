import type { ApiClient, GenerateStoryRequest, Story } from "@vjt/api-client";
import { useStory, useStoryGeneration, type StoryGenerationState, type TodaysStoryState } from "@vjt/core";
import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";

import { Card } from "./components/ui/Card.tsx";
import { CONTENT_MAX_WIDTH, OVERLAY_BREAKPOINT, SIDEBAR_BREAKPOINT } from "./chrome/Shell.tsx";
import { pageSummary } from "./reader/parts.tsx";
import { SkeletonBar } from "./state/states.tsx";
import {
  ActionButton,
  ConfirmDelete,
  FilterChip,
  GenerateDialog,
  GenerationProgress,
  genreLabel,
  LibrarySkeleton,
  LibraryStates,
  originLabel,
  Picker,
  StoryCard,
  StoryMenu,
  storyDate,
} from "./stories-parts.tsx";

/**
 * The Stories page (issue #48, plan §4.5): Today's Story pinned at the top with
 * Generate beside it, and the Story Library underneath — list rows on narrow
 * screens, a grid of cards once there is room for columns.
 *
 * Everything the Learner acts on sits on the pinned card or on a Library card;
 * the only extra surfaces are the two dialogs — Generate, and the confirmation
 * before a Story is deleted. A card opens the Reader at `/stories/:id` (the
 * route passes `onOpenStory`), so this page never holds the reading column.
 *
 * The menu and dialogs take their sheet form below the same width the reader's
 * overlays do (OVERLAY_BREAKPOINT), and the Library switches to columns at the
 * chrome's sidebar width (SIDEBAR_BREAKPOINT) — both imported from the Shell so
 * the page never re-declares a number. Styling is design-token classes only.
 */

/** Page size of the Library's pager; the server's default is the same. */
const LIBRARY_PAGE_SIZE = 20;

export interface StoriesProps {
  client: ApiClient;
  /** Opens the Reader for a story; this page never renders the column itself. */
  onOpenStory: (storyId: string) => void;
  /** Generation poll interval; only the tests shorten it. */
  generationPollMs?: number;
  /** Overrides the viewport, the way the Reader's `screenSize` does. */
  screenSize?: { width: number; height: number };
}

export function Stories({ client, onOpenStory, generationPollMs, screenSize }: StoriesProps) {
  const screen = useWindowDimensions();
  const size = screenSize ?? screen;
  const wide = size.width >= SIDEBAR_BREAKPOINT;
  const sheetOverlays = size.width < OVERLAY_BREAKPOINT;

  const view = useStory(client, LIBRARY_PAGE_SIZE);
  const gen = useStoryGeneration(client, generationPollMs ?? 1500);

  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [genre, setGenre] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [pickGenre, setPickGenre] = useState<string | null>(null);
  const [pickTheme, setPickTheme] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Story | null>(null);

  const status = gen.generation.status;
  const readyId = status === "ready" ? gen.generation.progress.storyId : undefined;

  // A run that finishes while the Learner is here lands in both halves of the
  // page without a reload. Only the transition counts: the server keeps the
  // last finished snapshot around, and re-reading on mount would ask for the
  // same thing twice (the same rule Today uses).
  const seenReady = useRef(false);
  const { reload, reloadToday } = view;
  useEffect(() => {
    if (status === "running") seenReady.current = false;
    else if (status === "ready" && !seenReady.current) {
      seenReady.current = true;
      reloadToday();
      reload();
    }
  }, [status, reload, reloadToday]);

  const items = view.library.status === "ready" ? view.library.page.items : [];

  // The delete confirmation closes itself once the Story is gone from the page
  // (removeStory patches it in place) — derived, not an effect. A failed delete
  // leaves the Story — and therefore the dialog, with the error line above it —
  // for another try.
  const confirmTarget =
    pendingDelete !== null && items.some((story) => story.id === pendingDelete.id) ? pendingDelete : null;

  const visible = items.filter(
    (story) => (!unreadOnly || !story.readAt) && (genre === null || story.genre === genre),
  );
  const filtered = unreadOnly || genre !== null;
  const hiddenByFilter = items.length - visible.length;

  // The Genre filter offers the server's suggestions plus every Genre actually
  // on screen, so a filter never hides a Story behind a value it cannot name.
  const genreChoices = Array.from(
    new Set([...gen.suggestions.genres, ...items.map((story) => story.genre).filter((g): g is string => Boolean(g))]),
  );

  function toggleReveal(storyId: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  }

  function startGeneration() {
    const request: GenerateStoryRequest = {};
    if (pickGenre) request.genre = pickGenre;
    if (pickTheme) request.theme = pickTheme;
    void gen.startGeneration(request);
  }

  function clearFilters() {
    setUnreadOnly(false);
    setGenre(null);
  }

  const page = view.library.status === "ready" ? view.library.page : null;

  return (
    <ScrollView className="flex-1" accessibilityLabel="Stories" contentContainerStyle={styles.page}>
      <View className="w-full gap-5" style={styles.column}>
        {/* ── Today's Story, pinned, with Generate beside it ─────────────── */}
        <View testID="today-section" className="gap-3">
          <Text role="heading" accessibilityRole="header" className="text-title-sm font-semibold text-foreground">
            Today&rsquo;s Story
          </Text>
          <View className={wide ? "flex-row items-stretch gap-3" : "gap-3"}>
            <View className={wide ? "flex-1" : undefined}>
              <TodayCard
                today={view.today}
                generation={gen.generation}
                readyId={readyId}
                onReloadToday={view.reloadToday}
                onOpenStory={onOpenStory}
                onOpenGenerate={() => setGenerateOpen(true)}
                fill={wide}
              />
            </View>
            {/* Secondary/outline: the pinned card's Open stays the page's only
                filled primary on narrow, where the two stack (issue #48 review). */}
            <ActionButton
              label={status === "running" ? "Writing…" : "Generate"}
              accessibilityHint="Writes one new Story now, with an optional Genre and Theme"
              disabled={status === "running"}
              fullWidth={!wide}
              onPress={() => setGenerateOpen(true)}
              testID="today-generate"
            />
          </View>
        </View>

        {/* ── The Story Library ─────────────────────────────────────────── */}
        <View testID="library-section" className="gap-3">
          <Text role="heading" accessibilityRole="header" className="text-title-sm font-semibold text-foreground">
            Story Library
          </Text>

          <View testID="library-filters" style={styles.filterRow}>
            <View style={styles.chipRow}>
              <FilterChip
                label="Unread"
                active={unreadOnly}
                onPress={() => setUnreadOnly(true)}
                testID="filter-unread"
              />
              <FilterChip
                label="All"
                active={!unreadOnly}
                onPress={() => setUnreadOnly(false)}
                testID="filter-all"
              />
            </View>
            <Picker
              testID="genre-filter"
              ariaLabel="Genre filter"
              placeholder="All genres"
              value={genre}
              options={genreChoices}
              onChange={setGenre}
            />
          </View>

          {view.library.status === "loading" ? <LibrarySkeleton /> : null}

          {view.error ? (
            <Text accessibilityRole="alert" role="alert" testID="library-action-error" className="text-small text-destructive">
              {view.error}
            </Text>
          ) : null}

          {view.library.status === "ready" && visible.length > 0 ? (
            <View
              testID={wide ? "library-grid" : "library-list"}
              style={wide ? styles.grid : styles.list}
            >
              {visible.map((story) => (
                <View key={story.id} style={wide ? styles.gridCell : undefined}>
                  <StoryCard
                    story={story}
                    revealed={revealed.has(story.id)}
                    onToggleReveal={() => toggleReveal(story.id)}
                    onOpen={() => onOpenStory(story.id)}
                    menu={
                      <StoryMenu
                        story={story}
                        narrow={sheetOverlays}
                        onMarkRead={() => void view.setRead(story.id)}
                        onMarkUnread={() => void view.clearRead(story.id)}
                        onAskDelete={() => setPendingDelete(story)}
                      />
                    }
                  />
                </View>
              ))}
            </View>
          ) : (
            <LibraryStates
              library={view.library}
              visibleCount={visible.length}
              filtered={filtered}
              onRetry={view.reload}
              onClearFilters={clearFilters}
              onGenerate={() => setGenerateOpen(true)}
            />
          )}

          {hiddenByFilter > 0 ? (
            <Text className="text-caption text-muted-foreground" testID="library-filter-note">
              {`${hiddenByFilter} of the ${items.length} Stories on this page are hidden by your filters.`}
            </Text>
          ) : null}

          {page && page.total > page.items.length ? (
            <View testID="library-pager" style={styles.pager}>
              <ActionButton
                label="Newer stories"
                accessibilityLabel="Newer stories"
                disabled={page.offset === 0}
                onPress={() => void view.loadPage(Math.max(0, page.offset - page.limit))}
                testID="pager-newer"
              />
              <Text className="text-caption text-muted-foreground" testID="library-page-summary">
                {pageSummary(page)}
              </Text>
              <ActionButton
                label="Older stories"
                accessibilityLabel="Older stories"
                disabled={page.offset + page.items.length >= page.total}
                onPress={() => void view.loadPage(page.offset + page.items.length)}
                testID="pager-older"
              />
            </View>
          ) : null}
        </View>
      </View>

      {generateOpen ? (
        <GenerateDialog
          narrow={sheetOverlays}
          suggestions={gen.suggestions}
          genre={pickGenre}
          theme={pickTheme}
          onGenreChange={setPickGenre}
          onThemeChange={setPickTheme}
          generation={gen.generation}
          error={gen.error}
          onGenerate={startGeneration}
          onClose={() => setGenerateOpen(false)}
        />
      ) : null}

      {confirmTarget ? (
        <ConfirmDelete
          narrow={sheetOverlays}
          story={confirmTarget}
          pending={view.pending}
          error={view.error}
          onKeep={() => setPendingDelete(null)}
          onConfirm={() => void view.removeStory(confirmTarget.id)}
        />
      ) : null}
    </ScrollView>
  );
}

/**
 * The pinned Today card (issue #48): the newest Automatic Story, or the state
 * that explains why there isn't one — with the progress of a live run and a way
 * to read the Story an On-demand run just wrote.
 */
function TodayCard({
  today,
  generation,
  readyId,
  onReloadToday,
  onOpenStory,
  onOpenGenerate,
  fill,
}: {
  today: TodaysStoryState;
  generation: StoryGenerationState;
  /** The Story a finished run wrote, when it is not the card's own. */
  readyId: string | undefined;
  onReloadToday: () => void;
  onOpenStory: (storyId: string) => void;
  onOpenGenerate: () => void;
  fill: boolean;
}) {
  const running = generation.status === "running" ? generation.progress : undefined;
  const readyStory = generation.status === "ready" ? generation.progress.storyId : undefined;
  // The finished run's Story is worth opening even before the reload lands it in
  // the card; once Today has it, the card's own Open button is the same action.
  const justWritten = readyStory && readyStory === readyId && (today.status !== "story" || today.story.id !== readyStory);

  return (
    <Card testID="today-card" fill={fill} pinned>
      {today.status === "loading" ? (
        // Shaped like the settled card: a title bar, a meta line, the button
        // block (plan §5) — so nothing jumps when the story lands.
        <View className="gap-3">
          <SkeletonBar width="70%" height={24} />
          <SkeletonBar width="45%" height={14} />
          <SkeletonBar width={96} height={44} />
        </View>
      ) : today.status === "story" ? (
        <View className="gap-3">
          <Text className="text-title font-semibold text-foreground" testID="today-story-title">
            {today.story.title}
          </Text>

          <Text className="text-small text-muted-foreground" testID="today-story-meta">
            {`${genreLabel(today.story.genre) || "Story"} · ${originLabel(today.story)} · ${storyDate(today.story.createdAt)}`}
          </Text>
          <ActionButton
            label={today.story.readAt ? "Read again" : "Open"}
            accessibilityLabel={today.story.readAt ? "Read today's story again" : "Open today's story"}
            onPress={() => onOpenStory(today.story.id)}
            filled
            testID="today-open"
          />
          {running ? <GenerationProgress progress={running} /> : null}
          {justWritten ? (
            <ActionButton
              label="Ready, read now"
              accessibilityHint="Opens the Story that was just written"
              onPress={() => onOpenStory(readyStory)}
              testID="today-ready"
            />
          ) : null}
        </View>
      ) : running ? (
        <View className="gap-3">
          <Text className="text-body text-muted-foreground">A new Story is on its way.</Text>
          <GenerationProgress progress={running} />
        </View>
      ) : today.status === "error" ? (
        <TodayCardState today={today} onReloadToday={onReloadToday} />
      ) : generation.status === "failed" ? (
        // The run failed rather than the read: the line is the server's own
        // words, and the way to try again is the Generate dialog.
        <View className="gap-3">
          <Text accessibilityRole="alert" role="alert" className="text-body text-destructive">
            {generation.progress.message ?? "Couldn’t write a Story for you."}
          </Text>
          <ActionButton label="Try again" onPress={onOpenGenerate} testID="today-retry" />
        </View>
      ) : (
        <View className="gap-3">
          <Text className="text-body text-muted-foreground">
            No Story for today yet — the tutor writes one for you every day.
          </Text>
          <ActionButton
            label="Check again"
            accessibilityHint="Asks the tutor whether today's Story has been written"
            onPress={onReloadToday}
            testID="today-check-again"
          />
        </View>
      )}
    </Card>
  );
}

/** Today's read failing: the same failure words as the Library's, one Retry. */
function TodayCardState({
  today,
  onReloadToday,
}: {
  today: Extract<TodaysStoryState, { status: "error" }>;
  onReloadToday: () => void;
}) {
  return (
    <View className="gap-3">
      <Text className="text-body text-destructive">{`Cannot load today’s Story: ${today.message}`}</Text>
      <ActionButton label="Check again" onPress={onReloadToday} testID="today-check-again" />
    </View>
  );
}

const styles = StyleSheet.create({
  // Top safe-area insets are the Shell's job, not this screen's (as on Today).
  page: { flexGrow: 1, padding: 16, paddingTop: 24 },
  // The Shell caps the column on wide screens; this keeps the measure narrow when it doesn't.
  column: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, gap: 20 },
  filterRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  list: { gap: 12 },
  // Two columns on wide screens, growing with the row rather than a fixed width
  // so the last row never leaves a gap-sized hole.
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  gridCell: { flexBasis: "46%", flexGrow: 1, minWidth: 280 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
});

