import type { ApiClient } from "@vjt/api-client";
import { useStory } from "@vjt/core";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "./theme.ts";
import { Card, ErrorText, Muted, StatusText, Title } from "./ui.tsx";
import { pageSummary, RatingButtons } from "./reader/parts.tsx";
import { StoryReader } from "./reader/StoryReader.tsx";

/**
 * The Stories tab (issue #14): the Story Library — newest first, one page at
 * a time, each row rated — and the reader it drills into. Opening a row
 * fetches the full Story (questions and all); the hardware Back returns here.
 */
export function Stories({ client }: { client: ApiClient }) {
  const colors = useColors();
  const view = useStory(client);

  if (view.story) {
    return <StoryReader client={client} view={view} story={view.story} onBack={() => view.close()} />;
  }

  if (view.library.status === "loading")
    return (
      <>
        <Title text="Stories" />
        <Muted text="Loading stories…" />
      </>
    );
  if (view.library.status === "error") {
    return (
      <>
        <Title text="Stories" />
        <ErrorText text={view.library.message} />
        <Pressable accessibilityRole="button" onPress={view.reload} style={styles.retry}>
          <Text style={{ color: colors.accent, fontSize: 16 }}>Retry</Text>
        </Pressable>
      </>
    );
  }

  const page = view.library.page;
  const newestOffset = page.offset + page.items.length;
  return (
    <ScrollView accessibilityLabel="Story Library">
      <Title text="Stories" />
      {view.error ? <ErrorText text={view.error} /> : null}
      {page.items.length === 0 ? (
        <StatusText text="No stories yet. The tutor writes them for you regularly — check back soon." />
      ) : (
        page.items.map((story) => (
          <Card key={story.id}>
            <Pressable
              testID={`story-row-${story.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Open story: ${story.genre}`}
              onPress={() => void view.openStory(story.id)}
              style={styles.rowHead}
            >
              <Text style={{ color: colors.label, fontSize: 17, fontWeight: "600" }}>{story.genre}</Text>
              <Text style={{ color: colors.subtle, fontSize: 14 }}>
                {new Date(story.createdAt).toLocaleDateString()} · {Array.from(story.text).slice(0, 40).join("")}…
              </Text>
            </Pressable>
            <RatingButtons view={view} storyId={story.id} rating={story.rating} />
          </Card>
        ))
      )}
      {page.items.length > 0 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Newer stories"
            disabled={page.offset === 0}
            onPress={() => void view.loadPage(Math.max(0, page.offset - page.limit))}
            style={[styles.pageButton, page.offset === 0 && styles.pageDisabled]}
          >
            <Text style={{ color: colors.accent, fontSize: 15 }}>‹ Newer</Text>
          </Pressable>
          <Text style={{ color: colors.subtle, fontSize: 14 }}>{pageSummary(page)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Older stories"
            disabled={newestOffset >= page.total}
            onPress={() => void view.loadPage(newestOffset)}
            style={[styles.pageButton, newestOffset >= page.total && styles.pageDisabled]}
          >
            <Text style={{ color: colors.accent, fontSize: 15 }}>Older ›</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rowHead: { marginBottom: 8, gap: 2 },
  retry: { paddingVertical: 12 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 16 },
  pageButton: { paddingHorizontal: 12, paddingVertical: 10 },
  pageDisabled: { opacity: 0.4 },
});
