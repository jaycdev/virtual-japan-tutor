// One Grammar Point (ui-plan 4.6, /grammar/:grammarId): the pattern and meaning,
// the explanation, and the example sentences, with the explanation and sentences
// in the serif face. The read itself is the generating wait: the server writes a
// missing explanation inside GET /grammar/points/{id}, so while that read is in
// flight the page says so and holds a skeleton in the settled page's shape.
//
// All text here comes from the server (AI-generated), so it is rendered as React
// text nodes. Nothing is inserted as HTML.
import type { ApiClient, GrammarExample, GrammarPointDetail } from "@vjt/api-client";
import { useGrammarPoint, useT } from "@vjt/core";
import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router";

import { Ruby, type RubyRun } from "@/components/Ruby";
import { T } from "@/components/Text";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { boldRuns, clampSpan, parseExplanation } from "../grammar/model.ts";
import { useSession } from "../session/session.tsx";

/** Whether the history state says a catalogue row opened this page (see GrammarPage's Link). */
export function isFromCatalogue(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { from?: unknown }).from === "grammar";
}

/** Route module: reads the point named by the URL with the session's client. */
export function Component() {
  const { client } = useSession();
  const { grammarId } = useParams();
  return <GrammarPointPage client={client} pointId={parsePointId(grammarId)} />;
}

/** A catalogue id from the URL, or undefined when it is not one (no request is made then). */
export function parsePointId(raw: string | undefined): number | undefined {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : undefined;
}

export function GrammarPointPage({ client, pointId }: { client: ApiClient; pointId: number | undefined }) {
  const { tp } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { state, reload } = useGrammarPoint(client, pointId);

  // Back returns to the catalogue only when a catalogue row opened this page
  // (its state says so). Everything else (a reload, a post-login redirect, an
  // arrival from Practice) replaces to the catalogue, so Back never lands on the
  // wrong screen.
  const back = () => {
    if (isFromCatalogue(location.state)) navigate(-1);
    else navigate("/grammar", { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Pulled left by the ghost padding, so the chevron lines up with the content edge. */}
      <Button variant="ghost" aria-label={tp("grammar.backAria")} className="-ml-2 self-start text-primary hover:text-primary" onClick={back}>
        <ChevronLeft aria-hidden="true" />
        <T k="grammar.title" />
      </Button>

      {pointId === undefined ? (
        <p role="alert" className="text-body text-destructive">
          <T k="grammar.notCataloguePoint" />
        </p>
      ) : state.status === "loading" || state.status === "idle" ? (
        <GeneratingBody />
      ) : state.status === "error" ? (
        <ErrorState message={<T k="grammar.detailLoadFailed" params={{ message: state.message }} />} onRetry={reload} />
      ) : (
        <ReadyBody point={state.point} onReload={reload} />
      )}
    </div>
  );
}

/** While the first read is in flight: why this can take a moment, and a skeleton in the settled shape. */
function GeneratingBody() {
  return (
    <>
      <div className="flex flex-col gap-2" data-testid="grammar-detail-skeleton" aria-busy="true">
        <Skeleton className="h-7 w-2/5" />
        <Skeleton className="h-4 w-7/10" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="text-body text-muted-foreground">
            <T k="grammar.generating" />
          </p>
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3.5 w-1/2" />
        </CardContent>
      </Card>
    </>
  );
}

function ReadyBody({ point, onReload }: { point: GrammarPointDetail; onReload: () => void }) {
  return (
    <>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-serif-bold text-title text-foreground">{point.pattern}</h1>
          <Badge variant="secondary">{point.jlptLevel}</Badge>
          <span className="text-caption text-muted-foreground">{`#${point.catalogueNumber}`}</span>
        </div>
        <p lang="en" className="text-body text-foreground">{point.meaning}</p>
        {point.variants.length > 0 ? (
          <p className="text-caption text-muted-foreground">
            <T k="grammar.alsoWritten" params={{ variants: point.variants.join(", ") }} />
          </p>
        ) : null}
      </header>

      <Card>
        <CardContent>
        <section aria-labelledby="grammar-explanation-heading" className="flex flex-col gap-4">
          <h2 id="grammar-explanation-heading" className="text-title-sm font-semibold text-foreground">
            <T k="grammar.explanation" />
          </h2>
          {point.explanation === "" ? (
            // The server tried to generate the explanation inside this very read and
            // failed (usually no AI Provider for grammar content), so say that and
            // give the way out.
            <EmptyState
              compact
              message={<T k="grammar.explainFailed" />}
              action={
                <Button variant="outline" onClick={onReload}>
                  <T k="grammar.reload" />
                </Button>
              }
            />
          ) : (
            <ExplanationBody text={point.explanation} />
          )}
        </section>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
        <section aria-labelledby="grammar-examples-heading" className="flex flex-col gap-4">
          <h2 id="grammar-examples-heading" className="text-title-sm font-semibold text-foreground">
            <T k="grammar.examples" />
          </h2>
          {point.examples.length === 0 ? (
            <p className="text-body text-muted-foreground">
              <T k="grammar.noValidatedExamples" />
            </p>
          ) : (
            <ol className="flex flex-col gap-5">
              {point.examples.map((example) => (
                <li key={example.id}>
                  <ExampleRow example={example} />
                </li>
              ))}
            </ol>
          )}
        </section>
        </CardContent>
      </Card>
    </>
  );
}

/** The explanation in the serif face: paragraphs and bullet lists, with **bold** runs. */
export function ExplanationBody({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-3 font-serif text-body text-foreground">
      {parseExplanation(text).map((block, i) =>
        block.type === "paragraph" ? (
          <p key={i}>
            <BoldText text={block.text} />
          </p>
        ) : block.ordered ? (
          <ol key={i} className="flex list-decimal flex-col gap-1.5 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>
                <BoldText text={item} />
              </li>
            ))}
          </ol>
        ) : (
          <ul key={i} className="flex list-disc flex-col gap-1.5 pl-5">
            {block.items.map((item, j) => (
              <li key={j}>
                <BoldText text={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}

function BoldText({ text }: { text: string }) {
  return (
    <>
      {boldRuns(text).map((run, i) =>
        run.bold ? (
          <strong key={i} className="font-serif-bold">
            {run.text}
          </strong>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}

/** One example: the sentence in serif with its Grammar Span marked, and the translation under it. */
function ExampleRow({ example }: { example: GrammarExample }) {
  // spanStart and spanEnd are rune offsets, so split on code points, not UTF-16
  // units. The offsets are clamped to the sentence: a bad one marks less, and
  // never breaks the page.
  const chars = Array.from(example.sentenceJa);
  const { start, end } = clampSpan(example.spanStart, example.spanEnd, chars.length);
  const head = runsOf(chars.slice(0, start).join(""));
  const span = runsOf(chars.slice(start, end).join(""));
  const tail = runsOf(chars.slice(end).join(""));
  return (
    <div className="flex flex-col gap-1">
      <p lang="ja" className="font-serif text-body text-foreground">
        <Ruby runs={head} />
        <mark className="rounded-sm bg-grammar text-foreground">
          <Ruby runs={span} />
        </mark>
        <Ruby runs={tail} />
      </p>
      <p lang="en" className="text-small text-muted-foreground">{example.translationEn}</p>
    </div>
  );
}

/** One plain run for a piece of sentence, or none when the piece is empty. Readings are not in the API yet (#65 follow-up). */
function runsOf(text: string): RubyRun[] {
  return text === "" ? [] : [{ text }];
}
