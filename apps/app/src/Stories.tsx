import type { ApiClient, GenerateStoryRequest, Story, StoryGenerationProgress } from "@vjt/api-client";
import { type StoryGeneration, type StoryView, useStory, useStoryGeneration } from "@vjt/core";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "./theme.ts";
import {
  AutocompleteField,
  Card,
  ErrorText,
  LinkButton,
  Muted,
  PrimaryButton,
  StatusText,
  Title,
} from "./ui.tsx";
import { pageSummary, RatingButtons } from "./reader/parts.tsx";
import { StoryReader } from "./reader/StoryReader.tsx";
import type { MeasurableNode, Rect } from "./reader/holdMenu.ts";

/**
 * The Stories tab (issues #14, #34): it opens on Today's Story, and "View all
 * stories" opens the Story Library — newest first, one page at a time, each
 * row with its title (the English translation blurred until tapped), genre,
 * theme, origin, when it was made, a Read toggle, a delete that asks first,
 * and the rating thumbs. Tapping a row (or today's button) opens the reader;
 * Back returns to whichever view the Story was opened from, because that view
 * stays mounted underneath.
 */
export function Stories({
  client,
  onOpenStory,
  onPracticeStory,
  measure,
  screenSize,
  generationPollMs,
}: {
  client: ApiClient;
  /**
   * Opens a Story (issue #44): the router route passes router.push so reading
   * lives at /stories/:id — route Back is the router's and the chrome knows
   * to hide. Optional on purpose (#44 review, Q8): the component's own test
   * suite (~28 cases in Stories.test.tsx) drives the reader IN PLACE through
   * the fallback below. Making the prop required would force every one of
   * them to inject a no-op that still lands on this same fallback, so it
   * would add churn without removing the fallback. Hosts that route pass it;
   * hosts that just host the component let it open its own reader.
   */
  onOpenStory?: (storyId: string) => void;
  /**
   * Queues a Story for speaking practice from the reader's footer (issue #45).
   * Optional like onOpenStory: hosts that own the practice queue pass it; the
   * component test suites exercise the footer through it.
   */
  onPracticeStory?: (storyId: string) => void;
  /** Passed to the reader: test hosts inject menu geometry the DOM cannot measure. */
  measure?: (testID: string, node: MeasurableNode | null) => Rect | null;
  screenSize?: { width: number; height: number };
  /** Poll interval for the generation progress bar (tests shorten it). */
  generationPollMs?: number;
}) {
  const view = useStory(client);
  // One generation view for the whole screen: it stays mounted while the
  // reader is open, so switching views never restarts (or cancels) the run.
  const gen = useStoryGeneration(client, generationPollMs);
  // Today's Story is the landing view; "View all stories" opens the Story
  // Library, and the reader covers whichever one opened it.
  const [showLibrary, setShowLibrary] = useState(false);

  // Route-driven open (the /stories route) or in-place open (component tests).
  const openStory = (storyId: string) => {
    if (onOpenStory) onOpenStory(storyId);
    else void view.openStory(storyId);
  };

  // A run finishing while the Learner is anywhere on the tab: the Library
  // quietly picks the new Story up (seenReady keeps the reload once per run).
  const readyId = gen.generation.status === "ready" ? (gen.generation.progress.storyId ?? null) : null;
  const seenReady = useRef<string | null>(null);
  useEffect(() => {
    if (readyId && seenReady.current !== readyId) {
      seenReady.current = readyId;
      view.reload();
    }
  }, [readyId, view]);

  if (view.story) {
    return (
      <StoryReader
        client={client}
        view={view}
        story={view.story}
        onBack={() => view.close()}
        onPractice={onPracticeStory}
        measure={measure}
        screenSize={screenSize}
      />
    );
  }

  return (
    <ScrollView accessibilityLabel={showLibrary ? "Story Library" : "Stories"}>
      <Title text="Stories" />
      {view.error ? <ErrorText text={view.error} /> : null}
      <GeneratePanel gen={gen} onOpenStory={openStory} />
      {showLibrary ? (
        <StoryLibrary view={view} onBack={() => setShowLibrary(false)} onOpenStory={openStory} />
      ) : (
        <TodaysStoryPanel view={view} onViewAll={() => setShowLibrary(true)} onOpenStory={openStory} />
      )}
    </ScrollView>
  );
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "today", "yesterday", or the weekday name — the Learner's local calendar. */
function localDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameLocalDay(d, now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(d, yesterday)) return "yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

/** Which day today's slot is on: the ticket's "Still unread from Monday". */
function todayLine(s: Story): string {
  if (s.readAt) return `You read it ${localDayLabel(s.readAt)}.`;
  if (!sameLocalDay(new Date(s.createdAt), new Date())) return `Still unread from ${localDayLabel(s.createdAt)}.`;
  return "Written for you today.";
}

function TodaysStoryPanel({
  view,
  onViewAll,
  onOpenStory,
}: {
  view: StoryView;
  onViewAll: () => void;
  onOpenStory: (storyId: string) => void;
}) {
  const t = view.today;
  return (
    <>
      {t.status === "loading" && <Muted text="Writing today’s story…" />}
      {t.status === "story" && (
        <>
          <PrimaryButton
            label={t.story.readAt ? "Read today’s story again" : "Read today’s story"}
            disabled={view.pending}
            onPress={() => onOpenStory(t.story.id)}
          />
          <Muted text={todayLine(t.story)} />
        </>
      )}
      {t.status === "none" && (
        <>
          <Muted text="No story yet — the tutor writes one for you every day." />
          <LinkButton label="Check again" onPress={view.reloadToday} />
        </>
      )}
      {t.status === "error" && (
        <>
          <ErrorText text={`Cannot load today’s story: ${t.message}`} />
          <LinkButton label="Retry today’s story" onPress={view.reloadToday} />
        </>
      )}
      <LinkButton label="View all stories" onPress={onViewAll} />
    </>
  );
}

/**
 * The Generate box (issue #33, brought to mobile by #34): genre and theme are
 * optional free text with autocomplete; blank follows the Automatic rules, and
 * "Surprise me" lets the model pick both. The run lives on the server, so the
 * bar shows the server's snapshot and switching views never cancels it. A
 * finished run offers "Ready, read now" (never auto-opened); a rejected one
 * shows the retry line and leaves the form ready for another try.
 */
function GeneratePanel({
  gen,
  onOpenStory,
}: {
  gen: StoryGeneration;
  onOpenStory: (storyId: string) => void;
}) {
  const colors = useColors();
  const g = gen.generation;
  const [genre, setGenre] = useState("");
  const [theme, setTheme] = useState("");
  const running = g.status === "running";

  const start = (surprise: boolean) => {
    const req: GenerateStoryRequest = {};
    if (genre.trim() !== "") req.genre = genre.trim();
    if (theme.trim() !== "") req.theme = theme.trim();
    if (surprise) req.surprise = true;
    void gen.startGeneration(req);
  };

  return (
    <Card>
      <View style={styles.generateBody}>
        {running && (
          <View testID="generation-progress" accessibilityLabel="Story generation progress">
            <View style={[styles.progressTrack, { backgroundColor: colors.separator }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(100, Math.max(0, g.progress.percent))}%`,
                    backgroundColor: colors.accent,
                  },
                ]}
              />
            </View>
            <Muted text={`${stageLabel(g.progress)} ${g.progress.percent}%`} />
          </View>
        )}
        {g.status === "ready" && (
          <>
            <StatusText text="A new Story is ready for you." />
            <PrimaryButton
              label="Ready, read now"
              onPress={() => {
                if (g.status === "ready" && g.progress.storyId) onOpenStory(g.progress.storyId);
              }}
            />
          </>
        )}
        {g.status === "failed" && <ErrorText text={g.progress.message ?? "Couldn’t write your Story."} />}
        {gen.error ? <ErrorText text={gen.error} /> : null}
        <Muted text="Pick a genre and a theme for one new Story, leave them empty for your usual mix, or let the tutor choose." />
        <AutocompleteField
          label="Genre for this story"
          placeholder="travel, mystery… empty = automatic"
          maxLength={60}
          value={genre}
          disabled={running}
          options={gen.suggestions.genres}
          onChangeText={setGenre}
          onSubmit={() => start(false)}
        />
        <AutocompleteField
          label="Theme for this story"
          placeholder="a robot running a ramen shop — empty = automatic"
          maxLength={200}
          value={theme}
          disabled={running}
          options={gen.suggestions.themes}
          onChangeText={setTheme}
          onSubmit={() => start(false)}
        />
        <View style={styles.generateActions}>
          <PrimaryButton label="Generate" disabled={running} onPress={() => start(false)} />
          <LinkButton label="Surprise me" disabled={running} onPress={() => start(true)} />
        </View>
      </View>
    </Card>
  );
}

function stageLabel(p: StoryGenerationProgress): string {
  switch (p.stage) {
    case "preparing":
      return "Preparing…";
    case "writing":
      return p.attempt != null && p.maxAttempts != null
        ? `Writing… attempt ${p.attempt} of ${p.maxAttempts}`
        : "Writing…";
    case "checking":
      return "Checking it fits your vocabulary…";
    case "saving":
      return "Saving…";
    default:
      return "Writing…";
  }
}

const originLabel = (s: Story) => (s.origin === "on_demand" ? "On demand" : "Automatic");

function StoryLibrary({
  view,
  onBack,
  onOpenStory,
}: {
  view: StoryView;
  onBack: () => void;
  onOpenStory: (storyId: string) => void;
}) {
  const colors = useColors();
  // Same rules as the web Library (issue #31): the title's translation
  // reveals transiently — nothing is saved and no Weak Signal is recorded —
  // and delete asks in place before it happens.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const lib = view.library;
  return (
    <>
      <LinkButton label="Back to today’s story" onPress={onBack} />
      {lib.status === "loading" && <Muted text="Loading your stories…" />}
      {lib.status === "error" && (
        <>
          <ErrorText text={`Cannot load your library: ${lib.message}`} />
          <LinkButton label="Retry" onPress={view.reload} />
        </>
      )}
      {lib.status === "ready" && lib.page.items.length === 0 && (
        <StatusText text="No stories yet. One will be waiting after the next generation pass." ok={false} />
      )}
      {lib.status === "ready" &&
        lib.page.items.map((story) => {
          const isRevealed = revealed.has(story.id);
          return (
            <Card key={story.id}>
              <Pressable
                testID={`story-row-${story.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Open story: ${story.title}`}
                onPress={() => onOpenStory(story.id)}
                style={styles.rowHead}
              >
                <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{story.title}</Text>
              </Pressable>
              {story.titleEn ? (
                <Pressable
                  testID={`title-translation-${story.id}`}
                  accessibilityRole="button"
                  accessibilityLabel="Title translation"
                  accessibilityHint={isRevealed ? "Tap to hide the translation" : "Tap to show the translation"}
                  onPress={() => toggleReveal(story.id)}
                  style={styles.translation}
                >
                  {/* Android has no CSS blur (same trick as the Reading Panel):
                      the text stays in place, transparent until revealed. */}
                  <Text style={{ color: isRevealed ? colors.subtle : "transparent", fontSize: 14 }}>{story.titleEn}</Text>
                  {isRevealed ? null : (
                    <Text style={{ color: colors.subtle, fontSize: 12 }}>Title translation hidden — tap to show</Text>
                  )}
                </Pressable>
              ) : null}
              <Text style={{ color: colors.subtle, fontSize: 14 }}>
                {`${story.genre} · ${story.theme || "—"} · ${originLabel(story)} · ${new Date(story.createdAt).toDateString()}`}
              </Text>
              <View style={styles.actions}>
                <Pressable
                  testID={`read-toggle-${story.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={story.readAt != null ? "Unmark read" : "Mark read"}
                  accessibilityState={{ disabled: view.pending }}
                  disabled={view.pending}
                  onPress={() => void (story.readAt != null ? view.clearRead(story.id) : view.setRead(story.id))}
                  style={styles.action}
                >
                  <Text style={{ color: story.readAt != null ? colors.accent : colors.subtle, fontSize: 15 }}>
                    {story.readAt != null ? "✓ Read" : "Read"}
                  </Text>
                </Pressable>
                {confirmingDelete === story.id ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Confirm delete"
                      disabled={view.pending}
                      onPress={() => void view.removeStory(story.id)}
                      style={styles.action}
                    >
                      <Text style={{ color: colors.danger, fontSize: 15 }}>Confirm delete</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Keep"
                      onPress={() => setConfirmingDelete(null)}
                      style={styles.action}
                    >
                      <Text style={{ color: colors.accent, fontSize: 15 }}>Keep</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    testID={`delete-${story.id}`}
                    accessibilityRole="button"
                    accessibilityLabel="Delete"
                    onPress={() => setConfirmingDelete(story.id)}
                    style={styles.action}
                  >
                    <Text style={{ color: colors.danger, fontSize: 15 }}>Delete</Text>
                  </Pressable>
                )}
                <RatingButtons view={view} storyId={story.id} rating={story.rating} />
              </View>
            </Card>
          );
        })}
      {lib.status === "ready" && lib.page.items.length > 0 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Newer stories"
            disabled={lib.page.offset === 0}
            onPress={() => void view.loadPage(Math.max(0, lib.page.offset - lib.page.limit))}
            style={[styles.pageButton, lib.page.offset === 0 && styles.pageDisabled]}
          >
            <ChevronLeft size={22} color={colors.accent} strokeWidth={2.5} />
          </Pressable>
          <Text style={{ color: colors.subtle, fontSize: 14 }}>{pageSummary(lib.page)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Older stories"
            disabled={lib.page.offset + lib.page.items.length >= lib.page.total}
            onPress={() => void view.loadPage(lib.page.offset + lib.page.items.length)}
            style={[styles.pageButton, lib.page.offset + lib.page.items.length >= lib.page.total && styles.pageDisabled]}
          >
            <ChevronRight size={22} color={colors.accent} strokeWidth={2.5} />
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  generateBody: { padding: 14, gap: 12 },
  progressTrack: { height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 6 },
  progressFill: { height: "100%", borderRadius: 4 },
  generateActions: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" },
  rowHead: { marginBottom: 4 },
  translation: { marginBottom: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" },
  action: { paddingVertical: 8, paddingHorizontal: 4, minWidth: 44 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16 },
  pageButton: { paddingHorizontal: 12, paddingVertical: 10 },
  pageDisabled: { opacity: 0.4 },
});
