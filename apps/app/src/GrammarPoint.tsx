import type { ApiClient, GrammarExample, GrammarPointDetail } from "@vjt/api-client";
import { useGrammarPoint } from "@vjt/core";
import { type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { CONTENT_MAX_WIDTH } from "./chrome/Shell.tsx";
import { Card } from "./components/ui/Card.tsx";
import { Icon } from "./components/ui/icon.tsx";
import { EmptyState, InlineError, SkeletonBar } from "./state/states.tsx";

/**
 * Grammar Point detail (issue #49), /grammar/:id on Android and web. Plan
 * §4.6: the point's pattern and meaning up top, then the explanation and the
 * example sentences in the serif face.
 *
 * The read itself is the generating wait: the server writes a missing
 * explanation and validates examples synchronously inside GET
 * /grammar/points/{id} (apps/server grammar.go), so while that request is in
 * flight the page says so and holds a skeleton shaped like the settled page.
 * The screen reads its one point through useGrammarPoint (#49 review S4) —
 * no catalogue page rides along with a detail view.
 *
 * This is the viewing experience the plan describes. The old web detail's
 * editing controls (save/regenerate the explanation, generate examples) stay
 * available through useGrammar but are not on this screen — the plan's grammar
 * scope is catalogue and reading.
 *
 * Styling is design-token classes only (plan §3).
 */
export function GrammarPoint({
  client,
  pointId,
  onBack,
}: {
  client: ApiClient;
  /** undefined when the route's :id is not a catalogue id. */
  pointId: number | undefined;
  /** Returns to the catalogue (the router route passes router.back). */
  onBack: () => void;
}) {
  const { state, reload } = useGrammarPoint(client, pointId);

  return (
    <ScrollView className="flex-1" accessibilityLabel="Grammar point" contentContainerStyle={styles.page}>
      <View className="w-full gap-4" style={styles.column}>
        <BackRow onBack={onBack} />

        {pointId === undefined ? (
          // A route :id that is not a catalogue id: say so plainly; Back above
          // is the way out, so no Retry button (there is nothing to retry).
          <Text accessibilityRole="alert" role="alert" className="text-body text-destructive">
            This is not a grammar point from the catalogue.
          </Text>
        ) : state.status === "loading" || state.status === "idle" ? (
          <GeneratingBody />
        ) : state.status === "error" ? (
          <InlineError
            message={`Cannot load this grammar point: ${state.message}`}
            onRetry={reload}
          />
        ) : (
          <ReadyBody point={state.point} onReloadExplanation={reload} />
        )}
      </View>
    </ScrollView>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back to grammar"
      onPress={onBack}
      className="min-h-11 flex-row items-center gap-1 self-start active:opacity-80"
    >
      <Icon name="chevron-left" size="sm" className="text-primary" />
      <Text className="text-body font-semibold text-primary">Grammar</Text>
    </Pressable>
  );
}

/**
 * While the first read is in flight: the honest explanation of why this page
 * can take a moment, and skeletons in the settled page's shape (header, the
 * explanation card, the examples card).
 */
function GeneratingBody() {
  return (
    <>
      <View className="gap-2" testID="grammar-detail-skeleton">
        <SkeletonBar width="45%" height={26} />
        <SkeletonBar width="70%" height={18} />
      </View>
      <Card>
        <Text accessibilityLiveRegion="polite" role="status" className="text-body text-muted-foreground">
          Preparing this page — the tutor writes a Grammar Point’s explanation the first time it is opened.
        </Text>
        <View className="gap-2">
          <SkeletonBar width="100%" height={16} />
          <SkeletonBar width="100%" height={16} />
          <SkeletonBar width="60%" height={16} />
        </View>
      </Card>
      <Card>
        <SkeletonBar width={160} height={22} />
        <View className="gap-3">
          <View className="gap-2">
            <SkeletonBar width="80%" height={16} />
            <SkeletonBar width="50%" height={14} />
          </View>
          <View className="gap-2">
            <SkeletonBar width="70%" height={16} />
            <SkeletonBar width="45%" height={14} />
          </View>
        </View>
      </Card>
    </>
  );
}

function ReadyBody({ point, onReloadExplanation }: { point: GrammarPointDetail; onReloadExplanation: () => void }) {
  return (
    <>
      <View className="gap-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text
            role="heading"
            accessibilityRole="header"
            // font-serif-bold, not font-serif + font-semibold: global.css pins
            // the 400 face under font-serif, so the old weight class only
            // faked bold on web (#49 review S6). Same token face richLine uses.
            className="text-title font-serif-bold font-semibold text-foreground"
          >
            {point.pattern}
          </Text>
          <View className="rounded-full border border-border bg-secondary px-2.5 py-0.5">
            <Text className="text-caption font-semibold text-secondary-foreground">{point.jlptLevel}</Text>
          </View>
          <Text className="text-caption text-muted-foreground">{`#${point.catalogueNumber}`}</Text>
        </View>
        <Text className="text-body text-foreground">{point.meaning}</Text>
        {point.variants.length > 0 ? (
          <Text className="text-caption text-muted-foreground">{`Also written ${point.variants.join(", ")}`}</Text>
        ) : null}
      </View>

      <Card testID="grammar-explanation-card">
        <Text
          role="heading"
          accessibilityRole="header"
          className="text-title-sm font-semibold text-foreground"
        >
          Explanation
        </Text>
        {point.explanation === "" ? (
          // #49 review S1: the server attempts generation inside this very GET
          // (grammar.go), so an empty explanation on a page that was just
          // opened means that attempt failed — usually no AI Provider assigned
          // to grammar content. Say that, and give the way out; the old copy
          // ("writes one the first time this page is opened") was a lie here.
          <EmptyState
            compact
            message="The tutor could not generate this explanation. Check the AI Provider for grammar content in Settings, then reload this page."
            actionLabel="Reload"
            onAction={onReloadExplanation}
          />
        ) : (
          <ExplanationBody text={point.explanation} />
        )}
      </Card>

      <Card testID="grammar-examples-card">
        <Text
          role="heading"
          accessibilityRole="header"
          className="text-title-sm font-semibold text-foreground"
        >
          Example sentences
        </Text>
        {point.examples.length === 0 ? (
          <Text className="text-body text-muted-foreground">No validated examples yet.</Text>
        ) : (
          point.examples.map((example) => <ExampleRow key={example.id} example={example} />)
        )}
      </Card>
    </>
  );
}

/**
 * The explanation, in the serif face the plan gives this page. The server's
 * text is light Markdown — paragraphs, **bold**, "- " bullets (generate.go's
 * prompt) — rendered as Text runs rather than raw markup; the old web page
 * showed it in an editable textarea, which no Learner should have to read.
 */
export function ExplanationBody({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");
  return (
    <View className="gap-3">
      {paragraphs.map((paragraph, i) => {
        const lines = paragraph.split("\n");
        if (lines.length === 1 && !paragraph.startsWith("- ")) {
          return (
            <Text key={i} className="font-serif text-body text-foreground">
              {richLine(paragraph)}
            </Text>
          );
        }
        return (
          <View key={i} className="gap-1.5">
            {lines.map((line, j) => (
              <Text key={j} className="font-serif text-body text-foreground">
                {line.startsWith("- ") ? `• ${richLine(line.slice(2))}` : richLine(line)}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/** **bold** spans inside one line, as nested Text runs. */
function richLine(line: string): (string | ReactNode)[] {
  return line.split(/\*\*/g).map((part, i) =>
    i % 2 === 1 ? (
      <Text key={i} className="font-serif-bold font-semibold">
        {part}
      </Text>
    ) : (
      part
    ),
  );
}

/**
 * One example: the sentence in serif with its Grammar Span underlined (the
 * rune offsets, as the old web page's <mark> did), and the translation under
 * it.
 */
function ExampleRow({ example }: { example: GrammarExample }) {
  const chars = Array.from(example.sentenceJa);
  return (
    <View className="gap-1">
      <Text className="font-serif text-body text-foreground">
        {chars.slice(0, example.spanStart).join("")}
        <Text className="underline">
          {chars.slice(example.spanStart, example.spanEnd).join("")}
        </Text>
        {chars.slice(example.spanEnd).join("")}
      </Text>
      <Text className="text-small text-muted-foreground">{example.translationEn}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same page metrics as the catalogue and Today, the other tab screens.
  page: { flexGrow: 1, padding: 16, paddingTop: 24 },
  column: { width: "100%", maxWidth: CONTENT_MAX_WIDTH, gap: 16 },
});
