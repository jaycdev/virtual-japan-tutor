import type { Story } from "@vjt/api-client";
import {
  countGlosses,
  coveringSpan,
  firstGlosses,
  grammarCue,
  shortPartOfSpeechLabel,
  useT,
  type EntryLookup,
} from "@vjt/core";

import { Button } from "@/components/ui/button";
import { T, TableText } from "@/components/Text.tsx";
import { cn } from "@/lib/utils";
import type { StoryTextSize } from "../storysize/store.ts";
import { JlptBadge, SrsLevelText } from "./parts.tsx";
import { PitchGraph } from "./PitchGraph.tsx";
import { RubyText } from "./StoryText.tsx";
import "./reader.css"; // defines --reading-panel-height

/** What the Lookup describes: a word the Learner is pointing at, or its Grammar Span. */
export interface LookTarget {
  sentence: number;
  index: number;
  kind: "token" | "grammar";
}

/**
 * The Reading Panel (ui-plan 4.1): one fixed box above the text, as wide as the
 * column and a fixed height in the story text size, so the text below never moves.
 * It is sticky to the top of the viewport, so it stays in view as the Story scrolls.
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
  const { tp } = useT();
  const sentence = selected !== null ? story.sentences[selected] : undefined;

  return (
    <section
      aria-label={tp("reader.panelAria")}
      data-testid="reading-panel"
      // A fixed height in the story text size, whatever the content: the text below never moves.
      // One bottom border, not a frame (ui-plan 4.1).
      // Sticky to the top of the viewport so it stays in view while the Learner scrolls the Story.
      // z-10 lifts it over the story column (`relative`, later in the DOM, so it would otherwise
      // paint over the panel); every overlay is z-50 and still sits above it.
      className="sticky top-0 z-10 flex w-full flex-col overflow-hidden border-b border-border bg-card"
      style={{ height: "var(--reading-panel-height)" }}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
        {target ? (
          <>
            <p className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
              <T k="reader.wordMeaning" />
            </p>
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
            <T k="reader.panelHint" />
          </p>
        )}

        {sentence ? (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={onToggleBlur}
              aria-label={tp("reader.sentenceTranslationAria")}
              aria-describedby={blur ? "translation-hidden-note" : undefined}
              className="block w-full rounded-sm text-left text-small text-muted-foreground italic hover:text-foreground"
            >
              <span lang="en" className={cn(blur && "blur-xs select-none")}>{sentence.en}</span>
            </button>
            {blur ? (
              <p id="translation-hidden-note" data-testid="translation-hidden-note" className="text-caption text-muted-foreground">
                <T k="reader.translationHiddenNote" />
              </p>
            ) : null}
          </div>
        ) : null}

        {blurError ? (
          // The message says the reveal did not stick; Retry sends the same save again.
          <div role="alert" className="flex flex-wrap items-center gap-3 text-small text-destructive">
            <span className="flex-1">
              <T k="reader.blurSaveFailed" params={{ message: blurError }} />
            </span>
            <Button variant="outline" onClick={onRetryBlur}>
              <T k="common.retry" />
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LookupBody({ story, target, lookup }: { story: Story; target: LookTarget; lookup: EntryLookup }) {
  const { t } = useT();
  const sentence = story.sentences[target.sentence];
  const token = sentence?.tokens[target.index];
  if (!sentence || !token) return null;

  if (target.kind === "grammar") {
    const cue = grammarCue(token, coveringSpan(sentence, token));
    if (!cue) return null;
    return (
      <div data-testid="panel-lookup" className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-body font-semibold text-pitch">{cue.pattern}</p>
        <p className="text-small text-foreground">{cue.meaning}</p>
        <div className="ml-auto flex items-center gap-3">
          {cue.srsLevel != null ? <SrsLevelText level={cue.srsLevel} /> : null}
          {cue.jlptLevel ? <JlptBadge level={cue.jlptLevel} /> : null}
        </div>
      </div>
    );
  }

  // The row appears once there is real data: a lookup in flight, a failed one, or a
  // word with no entry renders nothing, and the fixed label above still marks the mode.
  const entry = token.entSeq !== undefined ? lookup.peek(token.entSeq, token.surface, token.reading) : undefined;
  if (!entry) return null;
  const glosses = firstGlosses(entry, 2);
  const more = countGlosses(entry) > glosses.length;
  const partOfSpeech = shortPartOfSpeechLabel(entry.senses, t);
  return (
    <div data-testid="panel-lookup" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <p className="text-body font-semibold text-pitch">{token.surface}</p>
      {token.reading && token.reading !== token.surface ? (
        <p className="text-body text-muted-foreground">{token.reading}</p>
      ) : null}
      {partOfSpeech ? (
        <span data-testid="panel-part-of-speech" className="text-caption text-muted-foreground">
          <TableText segments={partOfSpeech} />
        </span>
      ) : null}
      {glosses.map((gloss, i) => (
        <p key={i} className="text-small text-foreground">
          {gloss}
          {more && i === glosses.length - 1 ? "…" : ""}
        </p>
      ))}
      <div className="ml-auto flex items-center gap-3">
        {entry.pitch ? <PitchGraph pitch={entry.pitch} width={64} height={28} /> : null}
        {entry.srsLevel != null ? <SrsLevelText level={entry.srsLevel} /> : null}
        {entry.jlptLevel ? <JlptBadge level={entry.jlptLevel} /> : null}
      </div>
    </div>
  );
}
