import type { ApiClient, Story } from "@vjt/api-client";
import { type StoryView, useStory } from "@vjt/core";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "./theme.ts";
import { Card, ErrorText, LinkButton, Muted, PrimaryButton, StatusText, Title } from "./ui.tsx";
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
  measure,
  screenSize,
}: {
  client: ApiClient;
  /** Passed to the reader: test hosts inject menu geometry the DOM cannot measure. */
  measure?: (testID: string, node: MeasurableNode | null) => Rect | null;
  screenSize?: { width: number; height: number };
}) {
  const view = useStory(client);
  // Today's Story is the landing view; "View all stories" opens the Story
  // Library, and the reader covers whichever one opened it.
  const [showLibrary, setShowLibrary] = useState(false);

  if (view.story) {
    return (
      <StoryReader
        client={client}
        view={view}
        story={view.story}
        onBack={() => view.close()}
        measure={measure}
        screenSize={screenSize}
      />
    );
  }

  return (
    <ScrollView accessibilityLabel={showLibrary ? "Story Library" : "Stories"}>
      <Title text="Stories" />
      {view.error ? <ErrorText text={view.error} /> : null}
      {showLibrary ? (
        <StoryLibrary view={view} onBack={() => setShowLibrary(false)} />
      ) : (
        <TodaysStoryPanel view={view} onViewAll={() => setShowLibrary(true)} />
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

function TodaysStoryPanel({ view, onViewAll }: { view: StoryView; onViewAll: () => void }) {
  const t = view.today;
  return (
    <>
      {t.status === "loading" && <Muted text="Writing today’s story…" />}
      {t.status === "story" && (
        <>
          <PrimaryButton
            label={t.story.readAt ? "Read today’s story again" : "Read today’s story"}
            disabled={view.pending}
            onPress={() => void view.openStory(t.story.id)}
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

const originLabel = (s: Story) => (s.origin === "on_demand" ? "On demand" : "Automatic");

function StoryLibrary({ view, onBack }: { view: StoryView; onBack: () => void }) {
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
                onPress={() => void view.openStory(story.id)}
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
            <Text style={{ color: colors.accent, fontSize: 15 }}>‹ Newer</Text>
          </Pressable>
          <Text style={{ color: colors.subtle, fontSize: 14 }}>{pageSummary(lib.page)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Older stories"
            disabled={lib.page.offset + lib.page.items.length >= lib.page.total}
            onPress={() => void view.loadPage(lib.page.offset + lib.page.items.length)}
            style={[styles.pageButton, lib.page.offset + lib.page.items.length >= lib.page.total && styles.pageDisabled]}
          >
            <Text style={{ color: colors.accent, fontSize: 15 }}>Older ›</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  rowHead: { marginBottom: 4 },
  translation: { marginBottom: 4 },
  actions: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, flexWrap: "wrap" },
  action: { paddingVertical: 8, paddingHorizontal: 4, minWidth: 44 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16 },
  pageButton: { paddingHorizontal: 12, paddingVertical: 10 },
  pageDisabled: { opacity: 0.4 },
});
