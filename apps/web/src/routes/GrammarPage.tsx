// The Grammar Catalogue (ui-plan 4.6, /grammar). The URL is the source of truth
// for what the Learner is looking at: `?q=` the search, `?level=` the JLPT Level
// filter, `?page=` the page. Every change to them replaces the history entry and
// keeps the others, so a reload, a shared link or the sidebar Grammar link all
// reopen the same view. The level index always lists N5 to N1 and filters the
// catalogue server-side. "/" focuses search from anywhere outside a field.
// Opening a point and pressing Back returns here with the same view and scroll.
import type { ApiClient, GrammarPointSummary } from "@vjt/api-client";
import { useGrammar, useT, pluralEn, type GrammarLevelFilter } from "@vjt/core";
import { ChevronRight, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { T } from "@/components/Text";
import { EmptyState, ErrorState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { InterfaceLanguage, StringKey, TranslateParams } from "@vjt/core";
import {
  exampleCountLabel,
  groupByLevel,
  LEVEL_ORDER,
  offsetForPage,
  PAGE_SIZE,
  parseLevel,
  parsePage,
  readBrowse,
  saveBrowse,
  SEARCH_DEBOUNCE_MS,
  statusOf,
} from "../grammar/model.ts";
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

/** The level index's choices: every level, and "All levels" (no filter). */
const LEVEL_CHOICES: GrammarLevelFilter[] = ["all", ...LEVEL_ORDER];

export function GrammarCatalogue({ client }: { client: ApiClient }) {
  const { language } = useT();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const urlLevel = parseLevel(params.get("level"));
  const urlOffset = offsetForPage(parsePage(params.get("page")));
  // Read once per visit: the scroll position the Learner left this entry at, if any.
  const [restored] = useState(() => readBrowse(location.key));

  const grammar = useGrammar(client, { query: urlQuery, offset: urlOffset, level: urlLevel });
  const { state, filter, setQuery, setLevel, setOffset, reload } = grammar;

  // The typed term is local until the debounce fires: the catalogue re-reads on
  // every change of query, and one request per keystroke is noise.
  const [term, setTerm] = useState(urlQuery);
  // The URL changed from outside this screen (the sidebar link, Back, a typed
  // address): adopt it, during render, as React recommends for state that follows
  // a prop. Our own writes already match the screen, so they change nothing.
  const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);
  if (urlQuery !== seenUrlQuery) {
    setSeenUrlQuery(urlQuery);
    if (urlQuery !== filter.query) {
      setQuery(urlQuery);
      setTerm(urlQuery);
    }
  }
  const searchRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<number | null>(restored?.scrollY ?? null);
  const focusResults = useRef(false);

  /** Set URL params by replacing the entry, keeping the ones not named. null or "" removes one. */
  const writeParams = useCallback(
    (patch: Record<string, string | null>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === null || value === "") next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  // Typed search: settle, then write ?q= and re-read. A new search starts at page one.
  useEffect(() => {
    if (term === filter.query) return;
    const timer = window.setTimeout(() => {
      writeParams({ q: term, page: null });
      setQuery(term);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [term, filter.query, setQuery, writeParams]);

  useEffect(() => {
    if (urlLevel !== filter.level) setLevel(urlLevel);
  }, [urlLevel, filter.level, setLevel]);

  useEffect(() => {
    if (urlOffset !== filter.offset) setOffset(urlOffset);
  }, [urlOffset, filter.offset, setOffset]);

  // Back lands at the scroll position the Learner left, once the list has rows.
  useEffect(() => {
    if (state.status !== "ready" || pendingScroll.current === null) return;
    window.scrollTo({ top: pendingScroll.current });
    pendingScroll.current = null;
  }, [state.status]);

  // After a level is chosen, focus moves to the results heading (the list changed under the Learner).
  useEffect(() => {
    if (state.status !== "ready" || !focusResults.current) return;
    focusResults.current = false;
    resultsRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  }, [state]);

  // "/" focuses search, unless the Learner is typing (or composing) in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.isComposing || event.defaultPrevented) return;
      if (isEditable(event.target)) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const chooseLevel = (level: GrammarLevelFilter) => {
    focusResults.current = true;
    writeParams({ level: level === "all" ? null : level, page: null });
    setLevel(level);
  };

  const choosePage = (offset: number) => {
    setOffset(offset);
    writeParams({ page: offset === 0 ? null : String(offset / PAGE_SIZE + 1) });
    window.scrollTo({ top: 0 });
  };

  const remember = () => saveBrowse({ key: location.key, scrollY: window.scrollY });

  const groups = state.status === "ready" ? groupByLevel(state.page.items) : [];
  const searching = filter.query !== "";
  const levelChosen = filter.level !== "all";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h1 className="text-display font-semibold text-foreground">
          <T k="grammar.title" />
        </h1>
        <SearchField inputRef={searchRef} term={term} onTermChange={setTerm} />
      </div>

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[8rem_minmax(0,1fr)] lg:items-start lg:gap-8">
        <LevelIndex current={filter.level} onChoose={chooseLevel} />

        <div ref={resultsRef} className="flex min-w-0 flex-col gap-6">
          {state.status === "loading" ? (
            // Shaped like the settled page, so nothing jumps when the points land.
            <div className="flex flex-col gap-6" aria-busy="true" data-testid="grammar-list-skeleton">
              <LevelGroupSkeleton />
              <LevelGroupSkeleton />
            </div>
          ) : state.status === "error" ? (
            <ErrorState
              message={<T k="grammar.loadFailed" params={{ message: state.message }} />}
              onRetry={reload}
            />
          ) : state.page.items.length === 0 ? (
            searching ? (
              <EmptyState
                message={<T k="grammar.noSearchMatch" params={{ query: filter.query }} />}
                action={
                  <Button variant="outline" onClick={() => setTerm("")}>
                    <T k="grammar.clearSearch" />
                  </Button>
                }
              />
            ) : levelChosen ? (
              <EmptyState
                message={<T k="grammar.noLevelPoints" params={{ level: filter.level }} />}
                action={
                  <Button variant="outline" onClick={() => chooseLevel("all")}>
                    <T k="grammar.showAllLevels" />
                  </Button>
                }
              />
            ) : (
              <EmptyState message={<T k="grammar.emptyCatalogue" />} />
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
                  onOffset={choosePage}
                />
              ) : (
                // One page of results: a single count line says all a pager would.
                <p className="text-caption text-muted-foreground">
                  <T k="grammar.pointCount" params={{ count: state.page.total, plural: pluralEn(language, state.page.total) }} />
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
  const { tp } = useT();
  return (
    <div className="relative">
      <Label htmlFor="grammar-search" className="sr-only">
        <T k="grammar.searchLabel" />
      </Label>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="grammar-search"
        ref={inputRef}
        type="search"
        value={term}
        onChange={(event) => onTermChange(event.target.value)}
        placeholder={tp("grammar.searchPlaceholder")}
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
          aria-label={tp("grammar.clearSearchAria")}
          className="absolute right-1 top-1/2 -translate-y-1/2"
          onClick={() => onTermChange("")}
        >
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/**
 * The JLPT Level filter: All levels, then N5 to N1, always. Choosing one filters
 * the catalogue server-side (`?level=`). Beside the results from 1024 px, above
 * them below that. The chosen one carries aria-current and an active style.
 */
function LevelIndex({
  current,
  onChoose,
}: {
  current: GrammarLevelFilter;
  onChoose: (level: GrammarLevelFilter) => void;
}) {
  const { tp } = useT();
  return (
    <nav aria-label={tp("grammar.levelsAria")} className="lg:sticky lg:top-6 lg:self-start">
      <ul className="flex flex-wrap gap-1 lg:flex-col">
        {LEVEL_CHOICES.map((level) => {
          const active = level === current;
          return (
            <li key={level}>
              <button
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onChoose(level)}
                className={`min-h-11 rounded-md px-3 text-body font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:text-left ${
                  active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
              >
                {level === "all" ? <T k="grammar.allLevels" /> : level}
              </button>
            </li>
          );
        })}
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
  const { language, tp } = useT();
  return (
    <section id={levelId(level)} aria-labelledby={`${levelId(level)}-heading`} className="scroll-mt-6">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <h2
            id={`${levelId(level)}-heading`}
            tabIndex={-1}
            className="text-title-sm font-semibold text-foreground outline-none"
          >
            {level}
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {points.map((point) => (
              <li key={point.id}>
                <PointRow point={point} onOpen={onOpen} language={language} tp={tp} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

function PointRow({
  point,
  onOpen,
  language,
  tp,
}: {
  point: GrammarPointSummary;
  onOpen: () => void;
  language: InterfaceLanguage;
  tp: (k: StringKey, params?: TranslateParams) => string;
}) {
  // The label replaces the row's text for a screen reader, so it carries the
  // status (when there is one) and the example count too.
  const status = statusOf(point);
  const statusText = status === undefined ? undefined : tp(statusKey(status));
  const count = exampleCountLabel(point.exampleCount, language);
  return (
    <Link
      to={`/grammar/${point.id}`}
      state={{ from: "grammar" }}
      onClick={onOpen}
      aria-label={[point.pattern, point.meaning, statusText, count].filter(Boolean).join(", ")}
      className="-mx-2 flex items-center gap-4 rounded-md px-2 py-3 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-serif text-body text-foreground">{point.pattern}</span>
        <span lang="en" className="text-small text-muted-foreground">{point.meaning}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {status === undefined ? null : <StatusMark status={status} />}
        <span className="text-caption text-muted-foreground">{count}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

function statusKey(status: "seeded" | "observed" | "notKnown"): StringKey {
  if (status === "seeded") return "grammar.statusSeeded";
  if (status === "observed") return "grammar.statusObserved";
  return "grammar.statusNotKnown";
}

/** Seeded and Observed as a quiet pill; "Not known" as a caption, since there is no fact to badge. */
function StatusMark({ status }: { status: "seeded" | "observed" | "notKnown" }) {
  if (status === "notKnown")
    return (
      <span className="text-caption text-muted-foreground">
        <T k="grammar.statusNotKnown" />
      </span>
    );
  return (
    <Badge variant="secondary">
      <T k={statusKey(status)} />
    </Badge>
  );
}

function LevelGroupSkeleton() {
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
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
      </CardContent>
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
  const { tp } = useT();
  const from = shown === 0 ? 0 : offset + 1;
  const to = offset + shown;
  return (
    <nav aria-label={tp("grammar.pagesAria")} className="flex items-center justify-between gap-3">
      <Button variant="outline" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))}>
        <T k="common.previous" />
      </Button>
      <p className="text-caption text-muted-foreground">
        <T k="grammar.pageRange" params={{ from, to, total }} />
      </p>
      <Button variant="outline" disabled={to >= total} onClick={() => onOffset(offset + limit)}>
        <T k="common.next" />
      </Button>
    </nav>
  );
}
