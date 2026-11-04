import type { Story } from "@vjt/api-client";
import { countGlosses, coveringSpan, firstGlosses, type EntryLookup } from "@vjt/core";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { StoryTextSize } from "../storysize/store.ts";
import { JlptBadge } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";
import { RubyText } from "./StoryText.tsx";

/** What the Lookup describes: a word the Learner is pointing at, or its Grammar Span. */
export interface LookTarget {
  sentence: number;
  index: number;
  kind: "token" | "grammar";
}

/**
 * The Reading Panel (ui-plan 4.1): one fixed box above the text, as wide as the
 * column and a fixed height in the story text size, so the text below never moves.
 * Inside it, one of two things:
 *
 *   - a look-up (a word hovered, focused or opened): the word, its reading,
 *     the first glosses, the pitch graph and the JLPT level; or for a Grammar
 *     Span its Grammar Point and what it means;
 *   - otherwise the selected sentence and its Sentence Translation, which starts
 *     blurred until the Learner reveals it.
 *
 * The box scrolls inside when its content is longer than it is. Nothing here
 * changes its size.
 */
export function ReadingPanel({
  story,
  selected,
  target,
  lookup,
  size,
  blur,
  blurError,
  onToggleBlur,
  onRetryBlur,
}: {
  story: Story;
  selected: number | null;
  target: LookTarget | null;
  lookup: EntryLookup;
  size: StoryTextSize;
  /** Whether the translation is hidden (the saved reading setting). */
  blur: boolean;
  /** A failed save of the translation setting, shown with a Retry. */
  blurError: string | null;
  onToggleBlur: () => void;
  onRetryBlur: () => void;
}) {
  const sentence = selected !== null ? story.sentences[selected] : undefined;

  return (
    <section
      aria-label="Reading Panel"
      data-testid="reading-panel"
      // A fixed height in the story text size, whatever the content: the text below never moves.
      className="story-column-width mx-auto flex flex-col overflow-hidden rounded-lg border border-border bg-card"
      style={{ height: "calc(var(--story-text-size) * 9)" }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {target ? (
          <>
            <p className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">Word meaning</p>
            <LookupBody story={story} target={target} lookup={lookup} />
          </>
        ) : sentence ? (
          <p
            data-testid="panel-sentence"
            className="font-serif text-foreground"
            style={{ fontSize: "var(--story-text-size)", lineHeight: "var(--story-line-height)" }}
          >
            <RubyText tokens={sentence.tokens} size={size} />
          </p>
        ) : (
          <p className="text-small text-muted-foreground">
            Select a sentence to read its translation. Hover or focus a word to see its meaning.
          </p>
        )}

        {sentence ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={onToggleBlur}
              aria-label="Sentence Translation"
              aria-describedby={blur ? "translation-hidden-note" : undefined}
              className="block w-full rounded-sm text-left text-small text-muted-foreground italic hover:text-foreground"
            >
              <span className={cn(blur && "blur-xs select-none")}>{sentence.en}</span>
            </button>
            {blur ? (
              <p id="translation-hidden-note" data-testid="translation-hidden-note" className="text-caption text-muted-foreground">
                Translation hidden — click or press Enter to show
              </p>
            ) : null}
          </div>
        ) : null}

        {blurError ? (
          // The message says the reveal did not stick; Retry sends the same save again.
          <div role="alert" className="flex flex-wrap items-center gap-3 text-small text-destructive">
            <span className="flex-1">Could not save that — {blurError}</span>
            <Button variant="outline" onClick={onRetryBlur}>
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LookupBody({ story, target, lookup }: { story: Story; target: LookTarget; lookup: EntryLookup }) {
  const sentence = story.sentences[target.sentence];
  const token = sentence?.tokens[target.index];
  if (!sentence || !token) return null;

  if (target.kind === "grammar") {
    const span = coveringSpan(sentence, token);
    if (!span) return null;
    return (
      <div data-testid="panel-lookup" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-body font-semibold text-pitch">{span.pattern}</p>
        <p className="text-small text-foreground">{span.meaning}</p>
        <div className="ml-auto">{span.jlptLevel ? <JlptBadge level={span.jlptLevel} /> : null}</div>
      </div>
    );
  }

  // The row appears once there is real data: a lookup in flight, a failed one, or a
  // word with no entry renders nothing, and the fixed label above still marks the mode.
  const entry = token.entSeq !== undefined ? lookup.peek(token.entSeq, token.surface, token.reading) : undefined;
  if (!entry) return null;
  const glosses = firstGlosses(entry, 2);
  const more = countGlosses(entry) > glosses.length;
  return (
    <div data-testid="panel-lookup" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-body font-semibold text-pitch">{token.surface}</p>
      {token.reading && token.reading !== token.surface ? (
        <p className="text-body text-muted-foreground">{token.reading}</p>
      ) : null}
      {glosses.map((gloss, i) => (
        <p key={i} className="text-small text-foreground">
          {gloss}
          {more && i === glosses.length - 1 ? "…" : ""}
        </p>
      ))}
      <div className="ml-auto flex items-center gap-3">
        {entry.pitch ? <PitchGraph pitch={entry.pitch} width={64} height={28} /> : null}
        {entry.jlptLevel ? <JlptBadge level={entry.jlptLevel} /> : null}
      </div>
    </div>
  );
}
