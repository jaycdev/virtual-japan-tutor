// The Grammar Catalogue (ui-plan 4.6, /grammar): every Grammar Point grouped under
// its JLPT Level, with search kept in ?q= so a shared or reloaded URL reopens the
// same search. From 1024 px a sticky level index jumps between groups, and "/"
// focuses search from anywhere outside a field. Opening a point and pressing Back
// returns here with the same search and scroll position.
import type { ApiClient, GrammarPointSummary } from "@vjt/api-client";
import { useGrammar } from "@vjt/core";
import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { exampleCountLabel, groupByLevel, knowledgeOf, readBrowse, saveBrowse, SEARCH_DEBOUNCE_MS, type GrammarKnowledge } from "../grammar/model.ts";
import { useSession } from "../session/session.tsx";

/** Route module: the catalogue reads the session's client. */
export function Component() {
  const { client } = useSession();
  return <GrammarCatalogue client={client} />;
}

/** Whether a key press is typed into a field, where "/" must stay a character. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function GrammarCatalogue({ client }: { client: ApiClient }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  // Read once per visit: where the Learner left this entry, if they came back to it.
  const [restored] = useState(() => readBrowse(location.key));

  const grammar = useGrammar(client, { query: urlQuery, offset: restored?.offset ?? 0 });
  const { state, filter, setQuery, setOffset, reload } = grammar;

  // The typed term is local until the debounce fires: the catalogue re-reads on
  // every change of query, and one request per keystroke is noise.
  const [term, setTerm] = useState(urlQuery);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingScroll = useRef<number | null>(restored?.scrollY ?? null);

  useEffect(() => {
    if (term === filter.query) return;
    const timer = window.setTimeout(() => {
      setParams(term === "" ? {} : { q: term }, { replace: true });
      setQuery(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term, filter.query, setQuery, setParams]);

  // Back lands at the scroll position the Learner left, once the list has rows.
  useEffect(() => {
    if (state.status !== "ready" || pendingScroll.current === null) return;
    window.scrollTo({ top: pendingScroll.current });
    pendingScroll.current = null;
  }, [state.status]);

  // "/" focuses search, unless the Learner is typing in a field already.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const remember = () => saveBrowse({ key: location.key, offset: filter.offset, scrollY: window.scrollY });

  const groups = state.status === "ready" ? groupByLevel(state.page.items) : [];
  const showIndex = groups.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-display font-semibold text-foreground">Grammar</h1>
        <SearchField inputRef={searchRef} term={term} onTermChange={setTerm} />
      </div>

      <div className={showIndex ? "lg:grid lg:grid-cols-[8rem_minmax(0,1fr)] lg:items-start lg:gap-8" : undefined}>
        {showIndex ? <LevelIndex levels={groups.map((group) => group.level)} /> : null}

        <div className="flex min-w-0 flex-col gap-6">
          {state.status === "loading" ? (
            // Shaped like the settled page, so nothing jumps when the points land.
            <div className="flex flex-col gap-6" aria-busy="true" data-testid="grammar-list-skeleton">
              <LevelGroupSkeleton />
              <LevelGroupSkeleton />
            </div>
          ) : state.status === "error" ? (
            <ErrorState message={`Cannot load grammar points: ${state.message}`} onRetry={reload} />
          ) : state.page.items.length === 0 ? (
            filter.query === "" ? (
              <EmptyState message="No grammar points yet — a MaruMori sync fills this catalogue." />
            ) : (
              <EmptyState
                message={`Nothing matches “${filter.query}” — try another word.`}
                action={
                  <Button variant="outline" onClick={() => setTerm("")}>
                    Clear search
                  </Button>
                }
              />
            )
          ) : (
            <>
              {groups.map((group) => (
                <LevelGroup key={group.level} level={group.level} points={group.points} onOpen={remember} />
              ))}
              {state.page.total > state.page.limit ? (
                <Pager
                  offset={state.page.offset}
                  shown={state.page.items.length}
                  limit={state.page.limit}
                  total={state.page.total}
                  onOffset={(next) => {
                    setOffset(next);
                    window.scrollTo({ top: 0 });
                  }}
                />
              ) : (
                // One page of results: a single count line says all a pager would.
                <p className="text-caption text-muted-foreground">
                  {`${state.page.total} Grammar Point${state.page.total === 1 ? "" : "s"}`}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SearchField({
  inputRef,
  term,
  onTermChange,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  term: string;
  onTermChange: (term: string) => void;
}) {
  return (
    <div className="relative">
      <Label htmlFor="grammar-search" className="sr-only">
        Search grammar
      </Label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="grammar-search"
        ref={inputRef}
        type="search"
        value={term}
        onChange={(event) => onTermChange(event.target.value)}
        placeholder="Search pattern or meaning"
        autoComplete="off"
        spellCheck={false}
        className="pl-10 pr-12 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {term === "" ? (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 text-caption text-muted-foreground lg:inline-block"
        >
          /
        </kbd>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Clear search term"
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => onTermChange("")}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** The sticky jump index, from 1024 px (the sidebar breakpoint). Links scroll to the group in place. */
function LevelIndex({ levels }: { levels: string[] }) {
  function jump(event: MouseEvent<HTMLAnchorElement>, level: string) {
    // No hash in the URL: a hash entry would add a history step and break Back.
    event.preventDefault();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(levelId(level))?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }
  return (
    <nav aria-label="JLPT Levels" className="hidden lg:sticky lg:top-6 lg:block lg:self-start">
      <ul className="flex flex-col gap-1">
        {levels.map((level) => (
          <li key={level}>
            <a
              href={`#${levelId(level)}`}
              onClick={(event) => jump(event, level)}
              className="block rounded-md px-3 py-2 text-body font-semibold text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              {level}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function levelId(level: string): string {
  return `grammar-level-${level}`;
}

function LevelGroup({
  level,
  points,
  onOpen,
}: {
  level: string;
  points: GrammarPointSummary[];
  onOpen: () => void;
}) {
  return (
    <section id={levelId(level)} aria-labelledby={`${levelId(level)}-heading`} className="scroll-mt-6">
      <Card>
        <h2 id={`${levelId(level)}-heading`} className="text-title-sm font-semibold text-foreground">
          {level}
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {points.map((point) => (
            <li key={point.id}>
              <PointRow point={point} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function PointRow({ point, onOpen }: { point: GrammarPointSummary; onOpen: () => void }) {
  // The label replaces the row's text for a screen reader, so it carries the
  // badge and the example count too.
  const knowledge = knowledgeOf(point);
  const status = knowledge === undefined ? "Not recorded" : knowledge === "seeded" ? "Seeded" : "Observed";
  const count = exampleCountLabel(point.exampleCount);
  return (
    <Link
      to={`/grammar/${point.id}`}
      onClick={onOpen}
      aria-label={`${point.pattern}, ${point.meaning}, ${status}, ${count}`}
      className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-serif text-body text-foreground">{point.pattern}</span>
        <span className="text-small text-muted-foreground">{point.meaning}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <SourceBadge knowledge={knowledge} />
        <span className="text-caption text-muted-foreground">{count}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * Seeded and Observed as a quiet pill (a point should not read as a traffic
 * light). "Not known" is a caption, not a badge: there is no fact to show.
 */
function SourceBadge({ knowledge }: { knowledge: GrammarKnowledge | undefined }) {
  if (knowledge === undefined) return <span className="text-caption text-muted-foreground">Not recorded</span>;
  return <Badge>{knowledge === "seeded" ? "Seeded" : "Observed"}</Badge>;
}

/** A level group in placeholder bars, shaped like the settled group (ui-plan 5). */
function LevelGroupSkeleton() {
  return (
    <Card>
      <Skeleton className="h-6 w-12" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
          <Skeleton className="h-4 w-16" />
        </div>
      ))}
    </Card>
  );
}

/** Previous and Next over the page of 50 the hook asks for. */
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
    <nav aria-label="Grammar pages" className="flex items-center justify-between gap-3">
      <Button variant="outline" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
        Previous
      </Button>
      <p className="text-caption text-muted-foreground">{`${from}–${to} of ${total}`}</p>
      <Button variant="outline" disabled={to >= total} onClick={() => onOffset(offset + limit)}>
        Next
      </Button>
    </nav>
  );
}
