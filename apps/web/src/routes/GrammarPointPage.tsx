// One Grammar Point (ui-plan 4.6, /grammar/:grammarId): the pattern and meaning,
// the explanation, and the example sentences, with the explanation and sentences
// in the serif face. The read itself is the generating wait: the server writes a
// missing explanation inside GET /grammar/points/{id}, so while that read is in
// flight the page says so and holds a skeleton in the settled page's shape.
//
// All text here comes from the server (AI-generated), so it is rendered as React
// text nodes. Nothing is inserted as HTML.
import type { ApiClient, GrammarExample, GrammarPointDetail } from "@vjt/api-client";
import { useGrammarPoint } from "@vjt/core";
import { ChevronLeft } from "lucide-react";
import { useLocation, useNavigate, useParams } from "react-router";

import { Ruby, type RubyRun } from "@/components/Ruby";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { boldRuns, parseExplanation } from "../grammar/model.ts";
import { useSession } from "../session/session.tsx";

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
  const navigate = useNavigate();
  const location = useLocation();
  const { state, reload } = useGrammarPoint(client, pointId);

  // Back returns to the catalogue the Learner came from (its search and scroll
  // are restored there). A fresh deep link has no history to pop, so Back opens it.
  const back = () => {
    if (location.key !== "default") navigate(-1);
    else navigate("/grammar", { replace: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" aria-label="Back to grammar" className="self-start px-2 text-primary hover:text-primary" onClick={back}>
        <ChevronLeft aria-hidden="true" />
        Grammar
      </Button>

      {pointId === undefined ? (
        <p role="alert" className="text-body text-destructive">
          This is not a grammar point from the catalogue.
        </p>
      ) : state.status === "loading" || state.status === "idle" ? (
        <GeneratingBody />
      ) : state.status === "error" ? (
        <ErrorState message={`Cannot load this grammar point: ${state.message}`} onRetry={reload} />
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
        <p role="status" className="text-body text-muted-foreground">
          Preparing this page — the tutor writes a Grammar Point’s explanation the first time it is opened.
        </p>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </Card>
      <Card>
        <Skeleton className="h-6 w-40" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3.5 w-1/2" />
        </div>
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
          <Badge>{point.jlptLevel}</Badge>
          <span className="text-caption text-muted-foreground">{`#${point.catalogueNumber}`}</span>
        </div>
        <p className="text-body text-foreground">{point.meaning}</p>
        {point.variants.length > 0 ? (
          <p className="text-caption text-muted-foreground">{`Also written ${point.variants.join(", ")}`}</p>
        ) : null}
      </header>

      <Card>
        <section aria-labelledby="grammar-explanation-heading" className="flex flex-col gap-4">
          <h2 id="grammar-explanation-heading" className="text-title-sm font-semibold text-foreground">
            Explanation
          </h2>
          {point.explanation === "" ? (
            // The server tried to generate the explanation inside this very read and
            // failed (usually no AI Provider for grammar content), so say that and
            // give the way out.
            <EmptyState
              compact
              message="The tutor could not generate this explanation. Check the AI Provider for grammar content in Settings, then reload this page."
              action={
                <Button variant="outline" onClick={onReload}>
                  Reload
                </Button>
              }
            />
          ) : (
            <ExplanationBody text={point.explanation} />
          )}
        </section>
      </Card>

      <Card>
        <section aria-labelledby="grammar-examples-heading" className="flex flex-col gap-4">
          <h2 id="grammar-examples-heading" className="text-title-sm font-semibold text-foreground">
            Example sentences
          </h2>
          {point.examples.length === 0 ? (
            <p className="text-body text-muted-foreground">No validated examples yet.</p>
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
  // spanStart and spanEnd are rune offsets, so split on code points, not UTF-16 units.
  const chars = Array.from(example.sentenceJa);
  const head = runsOf(chars.slice(0, example.spanStart).join(""));
  const span = runsOf(chars.slice(example.spanStart, example.spanEnd).join(""));
  const tail = runsOf(chars.slice(example.spanEnd).join(""));
  return (
    <div className="flex flex-col gap-1">
      <p lang="ja" className="font-serif text-body text-foreground">
        <Ruby runs={head} />
        <mark className="rounded-sm bg-grammar text-foreground">
          <Ruby runs={span} />
        </mark>
        <Ruby runs={tail} />
      </p>
      <p className="text-small text-muted-foreground">{example.translationEn}</p>
    </div>
  );
}

/** One plain run for a piece of sentence, or none when the piece is empty. Readings are not in the API yet (#65 follow-up). */
function runsOf(text: string): RubyRun[] {
  return text === "" ? [] : [{ text }];
}
