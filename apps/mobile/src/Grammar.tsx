import type { ApiClient, GrammarJLPTLevel, GrammarPointSummary } from "@vjt/api-client";
import { useGrammar } from "@vjt/core";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useCSSVariable } from "uniwind";

import { Card } from "./components/ui/Card.tsx";
import { Icon } from "./components/ui/icon.tsx";
import { EmptyState, InlineError, SkeletonBar } from "./state/states.tsx";

/**
 * Grammar Catalogue (issue #49), the Grammar tab on Android and web. Plan §4.6:
 * the catalogue grouped by JLPT Level (easiest first), with search, and each
 * Grammar Point showing its pattern and whether it is Seeded, Observed or not
 * known. Tapping a row opens /grammar/:id through the router.
 *
 * Search rides the server's own filter (the `q` parameter useGrammar passes:
 * a case-insensitive match on pattern, romaji or meaning), debounced here so
 * typing does not fire one request per keystroke. Paging keeps the old web
 * catalogue's Previous/Next over a page of 50.
 *
 * Styling is design-token classes only (plan §3): no palette colours, no
 * inline font sizes; text-size classes stay ahead of colour classes on Text
 * (the uniwind ordering gotcha).
 */

/** How long a typed search term settles before the catalogue re-reads. */
const SEARCH_DEBOUNCE_MS = 300;

/** The plan's ordering of level sections, easiest first. */
const LEVEL_ORDER: GrammarJLPTLevel[] = ["N5", "N4", "N3", "N2", "N1"];

/**
 * Where the Learner had got to in the catalogue — the search term and the page
 * — kept for the app session so opening a point and pressing Back lands on the
 * same view, not page one of an unfiltered list (#49 review S3). Module state,
 * not component state: the route remounts this screen on Back, and a screen
 * that stays mounted keeps its own state anyway.
 */
let browsePosition: { term: string; offset: number } = { term: "", offset: 0 };

/** Test seam: each test starts from a fresh catalogue view. */
export function resetGrammarBrowsePosition(): void {
  browsePosition = { term: "", offset: 0 };
}

export function Grammar({
  client,
  onOpenPoint,
}: {
  client: ApiClient;
  /** Opens a point's detail (the router route passes router.push to /grammar/:id). */
  onOpenPoint: (pointId: number) => void;
}) {
  const grammar = useGrammar(client, { query: browsePosition.term, offset: browsePosition.offset });
  const { state, filter, setQuery, setOffset, reload } = grammar;

  // The typed term is local until the debounce fires: useGrammar re-reads the
  // page the instant query changes, and one request per keystroke is noise.
  // The settled term and page also go into browsePosition, so a return from a
  // detail screen reopens the same view (S3).
  const [term, setTerm] = useState(browsePosition.term);
  useEffect(() => {
    if (term === filter.query) return;
    const timer = setTimeout(() => {
      browsePosition = { term, offset: 0 };
      setQuery(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, filter.query, setQuery]);

  return (
    <ScrollView className="flex-1" accessibilityLabel="Grammar" contentContainerStyle={styles.page}>
      <View className="w-full gap-4" style={styles.column}>
        <Text
          role="heading"
          accessibilityRole="header"
          className="text-display font-semibold text-foreground"
        >
          Grammar
        </Text>

        <SearchField term={term} onTermChange={setTerm} />

        {state.status === "loading" ? (
          // Shaped like the settled page: two level cards of placeholder rows,
          // so nothing jumps when the points land (issue #47 review S7 shape).
          <View className="gap-4" testID="grammar-list-skeleton">
            <LevelGroupSkeleton />
            <LevelGroupSkeleton />
          </View>
        ) : state.status === "error" ? (
          <InlineError
            message={`Cannot load grammar points: ${state.message}`}
            onRetry={reload}
          />
        ) : state.page.items.length === 0 ? (
          <EmptyState
            message={
              filter.query === ""
                ? "No grammar points yet — a MaruMori sync fills this catalogue."
                : `Nothing matches “${filter.query}” — try another word.`
            }
            actionLabel={filter.query === "" ? undefined : "Clear search"}
            onAction={filter.query === "" ? undefined : () => setTerm("")}
          />
        ) : (
          <>
            {groupByLevel(state.page.items).map((group) => (
              <LevelGroup
                key={group.level}
                level={group.level}
                points={group.points}
                onOpenPoint={onOpenPoint}
              />
            ))}
            {state.page.total > state.page.limit ? (
              <Pager
                offset={state.page.offset}
                shown={state.page.items.length}
                limit={state.page.limit}
                total={state.page.total}
                onOffset={(next) => {
                  browsePosition = { term: filter.query, offset: next };
                  setOffset(next);
                }}
              />
            ) : (
              // #49 review S5: with one page of results the Previous/Next pair
              // is dead UI — two disabled buttons and a "1–1 of 1" caption.
              // One quiet count line says everything the pager had to say.
              <Text className="text-caption text-muted-foreground">
                {`${state.page.total} Grammar Point${state.page.total === 1 ? "" : "s"}`}
              </Text>
            )}
          </>
        )}
      </View>
    </ScrollView>
  );
}

/** The search box, with a clear button only while there is something to clear. */
function SearchField({ term, onTermChange }: { term: string; onTermChange: (term: string) => void }) {
  // The placeholder needs the token resolved by hand, not just a class: the
  // default renders dark-grey-on-dark on Android and near-white on web, where
  // it reads like entered text (#49 review B1). Same token-safe route as Icon
  // — useCSSVariable hands the colour to the prop both hosts honour: native
  // takes placeholderTextColor directly, react-native-web maps it onto the
  // input's ::placeholder via --placeholderTextColor.
  const placeholderColor = useCSSVariable("--color-muted-foreground");
  return (
    <View className="flex-row items-center gap-2">
      <TextInput
        value={term}
        onChangeText={onTermChange}
        placeholder="Search pattern or meaning"
        placeholderTextColor={placeholderColor ?? undefined}
        accessibilityLabel="Search grammar"
        autoCorrect={false}
        className="min-h-11 flex-1 rounded-lg border border-input bg-card px-3 text-body text-foreground"
      />
      {term !== "" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search term"
          onPress={() => onTermChange("")}
          className="min-h-11 min-w-11 items-center justify-center rounded-lg active:opacity-80"
        >
          <Icon name="close" size="sm" className="text-muted-foreground" />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Where a point came from, as the plan words it: Seeded (the catalogue's own
 * entries) or Observed (what the Learner's Sync has run into). The catalogue
 * list does not carry this field yet — only FocusSetItem has `source` — so a
 * summary without it reads honestly as "not known" (the issue #49 API gap
 * report). Read the same optional value when the catalogue starts returning
 * it, and drop the fallback.
 */
type GrammarKnowledge = "seeded" | "observed";

function knowledgeOf(point: GrammarPointSummary): GrammarKnowledge | undefined {
  const source = (point as { source?: unknown }).source;
  if (source === "seeded") return "seeded";
  if (source === "observed" || source === "marumori") return "observed";
  return undefined;
}

/**
 * Group the page's points under their JLPT Level, easiest first (plan §4.6).
 * The server already returns points ordered by level and catalogue number, so
 * each group keeps the server's order inside it; a level outside the known
 * five (should not happen against the enum) lands after them.
 */
export function groupByLevel(
  items: GrammarPointSummary[],
): { level: string; points: GrammarPointSummary[] }[] {
  const byLevel = new Map<string, GrammarPointSummary[]>();
  for (const point of items) {
    const group = byLevel.get(point.jlptLevel) ?? [];
    group.push(point);
    byLevel.set(point.jlptLevel, group);
  }
  const known = LEVEL_ORDER.filter((level) => byLevel.has(level)).map((level) => ({
    level: level as string,
    points: byLevel.get(level) as GrammarPointSummary[],
  }));
  const rest = [...byLevel.entries()]
    .filter(([level]) => !LEVEL_ORDER.includes(level as GrammarJLPTLevel))
    .map(([level, points]) => ({ level, points }));
  return [...known, ...rest];
}

function LevelGroup({
  level,
  points,
  onOpenPoint,
}: {
  level: string;
  points: GrammarPointSummary[];
  onOpenPoint: (pointId: number) => void;
}) {
  return (
    <Card testID={`grammar-group-${level}`}>
      <Text
        role="heading"
        accessibilityRole="header"
        className="text-title-sm font-semibold text-foreground"
      >
        {level}
      </Text>
      {points.map((point, i) => (
        <PointRow
          key={point.id}
          point={point}
          last={i === points.length - 1}
          onOpen={() => onOpenPoint(point.id)}
        />
      ))}
    </Card>
  );
}

function PointRow({
  point,
  last,
  onOpen,
}: {
  point: GrammarPointSummary;
  last: boolean;
  onOpen: () => void;
}) {
  // The label replaces the row's text content for TalkBack/VoiceOver, so it
  // must carry everything the visible row shows — badge and example count
  // included — or a screen-reader Learner hears less than a sighted one
  // (#49 review S2).
  const knowledge = knowledgeOf(point);
  const status = knowledge === "seeded" ? "Seeded" : knowledge === "observed" ? "Observed" : "Not recorded";
  const count = `${point.exampleCount} example${point.exampleCount === 1 ? "" : "s"}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${point.pattern}, ${point.meaning}, ${status}, ${count}`}
      onPress={onOpen}
      className={`flex-row items-center gap-3 py-3 active:opacity-80 ${
        last ? "" : "border-b border-border"
      }`}
    >
      <View className="flex-1 gap-1">
        <Text className="text-body font-serif text-foreground">{point.pattern}</Text>
        <Text className="text-small text-muted-foreground">{point.meaning}</Text>
      </View>
      <View className="items-end gap-1">
        <SourceBadge knowledge={knowledge} />
        {/* One interpolated string, so the whole caption is one text node. */}
        <Text className="text-caption text-muted-foreground">{`${point.exampleCount} example${
          point.exampleCount === 1 ? "" : "s"
        }`}</Text>
      </View>
      <Icon name="chevron-right" size="sm" className="text-muted-foreground" />
    </Pressable>
  );
}

/**
 * The plan's three knowledge states: Seeded and Observed as the secondary
 * pill every badge wears (a point should not read as a traffic light), and
 * the "not known" case as a quiet caption rather than a badge — there is no
 * fact to badge, only the absence of one.
 */
function SourceBadge({ knowledge }: { knowledge: GrammarKnowledge | undefined }) {
  if (!knowledge) return <Text className="text-caption text-muted-foreground">Not recorded</Text>;
  return (
    <View className="rounded-full border border-border bg-secondary px-2.5 py-0.5">
      <Text className="text-caption font-semibold text-secondary-foreground">
        {knowledge === "seeded" ? "Seeded" : "Observed"}
      </Text>
    </View>
  );
}

function LevelGroupSkeleton() {
  return (
    <Card>
      <SkeletonBar width={48} height={22} />
      {[0, 1, 2].map((i) => (
        <View key={i} className="flex-row items-center gap-3 py-3">
          <View className="flex-1 gap-2">
            <SkeletonBar width="40%" height={18} />
            <SkeletonBar width="60%" height={14} />
          </View>
          <SkeletonBar width={64} height={16} />
        </View>
      ))}
    </Card>
  );
}

/**
 * Previous/Next over the page of 50 the hook asks for — the old web
 * catalogue's paging, same bounds and same "from–to of total" line.
 */
function Pager({
  offset,
  shown,
  limit,
  total,
  onOffset,
}: {
  offset: number;
  shown: number;
  limit: number;
  total: number;
  onOffset: (offset: number) => void;
}) {
  const from = shown === 0 ? 0 : offset + 1;
  const to = offset + shown;
  return (
    <View className="flex-row items-center justify-between gap-3">
      <PagerButton
        label="Previous"
        disabled={offset === 0}
        onPress={() => onOffset(Math.max(0, offset - limit))}
      />
      <Text className="text-caption text-muted-foreground">{`${from}–${to} of ${total}`}</Text>
      <PagerButton
        label="Next"
        disabled={to >= total}
        onPress={() => onOffset(offset + limit)}
      />
    </View>
  );
}

function PagerButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-11 flex-row items-center justify-center rounded-md border border-border bg-card px-4 active:opacity-80${
        disabled ? " opacity-50" : ""
      }`}
    >
      {/* Text size before colour: uniwind drops a colour class placed before a
          custom text-size class on native. */}
      <Text className="text-body font-semibold text-foreground">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Same page metrics as Today, the other tab screen (issue #47).
  page: { flexGrow: 1, padding: 16, paddingTop: 24 },
  // The Shell caps the column on wide screens; this keeps the reading measure.
  column: { width: "100%", gap: 16 },
});
