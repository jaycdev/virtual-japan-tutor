// The Stories page (plan 4.5, issue #79): Today's Story pinned at the top with
// Generate beside it, and the Story Library underneath — a grid on wide screens,
// a list when asked, and the choice remembered on this device. Unread and Genre
// filters ride the URL, so reload and Back keep the Learner's view; they are
// honest page-local filters, not a fake server query (GET /stories only carries
// limit/offset — backend #63 would add the server side).
//
// The state cascade on the pinned card and every word it speaks is the shared
// @vjt/core code (todayCardPhase, issue #71); this file adds only the web form:
// links instead of taps, dropdown menus and centered dialogs instead of sheets.
import type { ApiClient, GenerateStoryRequest, Story } from "@vjt/api-client";
import {
  genreLabel,
  originLabel,
  stageLabel,
  storyDate,
  useStory,
  useStoryGeneration,
} from "@vjt/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Check, Grid2x2, List, MoreHorizontal, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState, ProgressStatus, SkeletonLines } from "@/components/states";
import { cn } from "@/lib/utils";
import { TodayStoryCard } from "./TodayStoryCard.tsx";

/** Page size of the Library's pager; the server's default is the same. */
const LIBRARY_PAGE_SIZE = 20;

/** The list/grid choice is this device's, not the server's (plan 4.5). */
export const STORIES_LAYOUT_STORAGE_KEY = "vjt.stories.layout";

export interface StoriesProps {
  client: ApiClient;
  /** Generation poll interval; only the tests shorten it. */
  generationPollMs?: number;
}

export function Stories({ client, generationPollMs }: StoriesProps) {
  const view = useStory(client, LIBRARY_PAGE_SIZE);
  const gen = useStoryGeneration(client, generationPollMs ?? 1500);

  const [params, setParams] = useSearchParams();
  // The filters live in the URL (?filter=unread&genre=travel): a reload, a Back
  // press or a shared link lands on the same view (#63's cheap web half).
  const unreadOnly = params.get("filter") === "unread";
  const genre = params.get("genre");

  const [layout, setLayout] = useState<"grid" | "list">(readLayout);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [pickGenre, setPickGenre] = useState<string | null>(null);
  const [pickTheme, setPickTheme] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Story | null>(null);
  // A run started from this page's Generate dialog — the only run the dialog
  // may speak of, and the only finish that steps the dialog aside. The server
  // keeps the last finished snapshot around, and a stale `failed` must not
  // greet a dialog that has started nothing (issue #48 review, S2).
  const [runHere, setRunHere] = useState(false);
  // The pinned card's ready offer is spent once opened, and never revived by
  // the server's stale snapshot on a reload (issue #48 review, S3).
  const [spentReady, setSpentReady] = useState(false);

  const status = gen.generation.status;

  // A run that finishes while the Learner is here lands in both halves of the
  // page without a reload. Only the transition counts (the same rule Today uses).
  const seenReady = useRef(false);
  const { reload, reloadToday } = view;
  useEffect(() => {
    if (status === "running") seenReady.current = false;
    else if (status === "ready" && !seenReady.current) {
      seenReady.current = true;
      reloadToday();
      reload();
    }
  }, [status, reload, reloadToday]);

  // The dialog steps aside on its own once a run it started is Ready — its
  // rendering derives from `finishedHere`, an effect never has to close it.
  const readyStoryId = status === "ready" ? gen.generation.progress.storyId : undefined;
  const finishedHere = runHere && status === "ready" ? (readyStoryId ?? null) : null;
  const readyFlash = finishedHere !== null && !spentReady ? finishedHere : null;

  const items = useMemo(() => (view.library.status === "ready" ? view.library.page.items : []), [view.library]);

  // The delete confirmation closes itself once the Story is gone from the page
  // (removeStory patches it in place) — derived, not an effect. A failed delete
  // leaves the Story — and therefore the dialog, with the error line inside it.
  const confirmTarget =
    pendingDelete !== null && items.some((story) => story.id === pendingDelete.id) ? pendingDelete : null;

  const visible = items.filter(
    (story) => (!unreadOnly || !story.readAt) && (genre === null || story.genre === genre),
  );
  const filtered = unreadOnly || genre !== null;
  const hiddenByFilter = items.length - visible.length;

  // The Genre filter offers the server's suggestions plus every Genre actually
  // on screen, so a filter never hides a Story behind a value it cannot name.
  const genreChoices = useMemo(
    () =>
      Array.from(
        new Set([...gen.suggestions.genres, ...items.map((story) => story.genre).filter((g): g is string => Boolean(g))]),
      ),
    [gen.suggestions.genres, items],
  );

  function setFilter(key: "filter" | "genre", value: string | null) {
    // The live URL, not this render's snapshot: two filter changes fired
    // quicker than React commits must compose, never resurrect a filter the
    // previous change removed (a stale `params` closure used to do exactly that).
    const next = new URLSearchParams(window.location.search);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  }

  function chooseLayout(next: "grid" | "list") {
    setLayout(next);
    try {
      window.localStorage.setItem(STORIES_LAYOUT_STORAGE_KEY, next);
    } catch {
      // A private-mode storage write only costs this device the memory.
    }
  }

  function toggleReveal(storyId: string) {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(storyId)) next.delete(storyId);
      else next.add(storyId);
      return next;
    });
  }

  function startGeneration() {
    const request: GenerateStoryRequest = {};
    if (pickGenre) request.genre = pickGenre;
    if (pickTheme) request.theme = pickTheme;
    setRunHere(true);
    setSpentReady(false);
    void gen.startGeneration(request);
  }

  function openGenerate() {
    // Sitting down to write another Story closes the last run's book: a fresh
    // dialog never inherits its finished state.
    setRunHere(false);
    setGenerateOpen(true);
  }

  const page = view.library.status === "ready" ? view.library.page : null;

  return (
    <div className="flex flex-col gap-6" data-testid="stories">
      <h1 className="text-display font-semibold text-foreground">Stories</h1>

      {/* ── Today's Story, pinned, with Generate beside it ─────────────── */}
      <div className="flex flex-col gap-3" data-testid="today-section">
        <TodayStoryCard
          variant="stories"
          today={view.today}
          generation={gen.generation}
          now={new Date()}
          timezone={view.settings.status === "ready" ? view.settings.settings.timezone : undefined}
          onReloadToday={view.reloadToday}
          onGenerate={openGenerate}
          readyStoryId={readyFlash}
          onOpenReady={() => setSpentReady(true)}
        />
        {/* The pinned card's Open stays the page's only filled primary; this
            button opens the dialog (plan 4.5). */}
        <Button
          variant="outline"
          onClick={openGenerate}
          disabled={status === "running"}
          data-testid="today-generate"
        >
          {status === "running" ? "Writing…" : "Generate a Story"}
        </Button>
      </div>

      {/* ── The Story Library ───────────────────────────────────────────── */}
      <section className="flex flex-col gap-3" aria-labelledby="library-heading" data-testid="library-section">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="library-heading" className="text-title-sm font-semibold text-foreground">
            Story Library
          </h2>
          <div className="flex items-center gap-1" role="group" aria-label="Library layout">
            <Button
              variant={layout === "grid" ? "secondary" : "ghost"}
              size="icon"
              aria-pressed={layout === "grid"}
              aria-label="Grid layout"
              onClick={() => chooseLayout("grid")}
              data-testid="layout-grid"
            >
              <Grid2x2 />
            </Button>
            <Button
              variant={layout === "list" ? "secondary" : "ghost"}
              size="icon"
              aria-pressed={layout === "list"}
              aria-label="List layout"
              onClick={() => chooseLayout("list")}
              data-testid="layout-list"
            >
              <List />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-testid="library-filters">
          <FilterChip label="Unread" active={unreadOnly} onPress={() => setFilter("filter", "unread")} />
          <FilterChip label="All" active={!unreadOnly} onPress={() => setFilter("filter", null)} />
          <label className="ml-2 flex items-center gap-2 text-small text-muted-foreground">
            Genre
            <select
              value={genre ?? ""}
              onChange={(event) => setFilter("genre", event.target.value === "" ? null : event.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-small text-foreground"
              data-testid="genre-filter"
            >
              <option value="">All genres</option>
              {genreChoices.map((option) => (
                <option key={option} value={option}>
                  {genreLabel(option) || option}
                </option>
              ))}
            </select>
          </label>
        </div>

        {view.library.status === "error" ? (
          // The page-level failure of the Library read itself: the same words
          // and the same Retry the mobile screen gives (view.error only carries
          // the actions).
          <ErrorState message={view.library.message} onRetry={reload} />
        ) : null}

        {view.library.status === "loading" ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="px-6">
                <SkeletonLines lines={3} />
              </Card>
            ))}
          </div>
        ) : null}

        {/* One line for page-level actions that failed; while the delete dialog
            is open the same failure already speaks inside it (issue #48 review, S10). */}
        {view.error && !confirmTarget ? (
          <p role="alert" className="text-small text-destructive" data-testid="library-action-error">
            {view.error}
          </p>
        ) : null}

        {view.library.status === "ready" && visible.length > 0 ? (
          <ul
            className={cn(
              layout === "grid" ? "grid gap-3 sm:grid-cols-2 xl:grid-cols-3" : "flex flex-col gap-3",
              "list-none",
            )}
            data-testid="library-list"
          >
            {visible.map((story) => (
              <li key={story.id}>
                <StoryCard
                  story={story}
                  revealed={revealed.has(story.id)}
                  onToggleReveal={() => toggleReveal(story.id)}
                  onMarkRead={() => void view.setRead(story.id)}
                  onMarkUnread={() => void view.clearRead(story.id)}
                  onAskDelete={() => setPendingDelete(story)}
                />
              </li>
            ))}
          </ul>
        ) : view.library.status === "ready" ? (
          <Card className="gap-4 px-6" data-testid="library-empty">
            {visible.length === 0 && items.length > 0 ? (
              <EmptyState
                compact
                message="No Stories match these filters."
                action={
                  <Button
                    variant="outline"
                    onClick={() => setParams(new URLSearchParams(), { replace: true })}
                  >
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                compact
                message={
                  filtered
                    ? "No Stories yet — and nothing to filter."
                    : "No Stories yet. The tutor writes one for you every day, or Generate writes one now."
                }
                action={
                  <Button variant="outline" onClick={openGenerate}>
                    Generate a Story
                  </Button>
                }
              />
            )}
          </Card>
        ) : null}

        {view.library.status === "ready" && hiddenByFilter > 0 ? (
          <p className="text-caption text-muted-foreground" data-testid="library-filter-note">
            {`${hiddenByFilter} of the ${items.length} Stories on this page are hidden by your filters.`}
          </p>
        ) : null}

        {page && page.total > page.items.length ? (
          <div className="flex items-center justify-between gap-3" data-testid="library-pager">
            <Button
              variant="outline"
              disabled={page.offset === 0}
              onClick={() => void view.loadPage(Math.max(0, page.offset - page.limit))}
              data-testid="pager-newer"
            >
              Newer stories
            </Button>
            <p className="text-caption text-muted-foreground" data-testid="library-page-summary">
              {pageSummary(page)}
            </p>
            <Button
              variant="outline"
              disabled={page.offset + page.items.length >= page.total}
              onClick={() => void view.loadPage(page.offset + page.items.length)}
              data-testid="pager-older"
            >
              Older stories
            </Button>
          </div>
        ) : null}
      </section>

      <GenerateDialog
        open={generateOpen && finishedHere === null}
        suggestions={gen.suggestions}
        genre={pickGenre}
        theme={pickTheme}
        onGenreChange={setPickGenre}
        onThemeChange={setPickTheme}
        running={status === "running"}
        progressLabel={status === "running" ? `${stageLabel(gen.generation.progress)} ${Math.round(gen.generation.progress.percent ?? 0)}%` : ""}
        progressValue={status === "running" ? (gen.generation.progress.percent ?? 0) / 100 : 0}
        error={
          runHere && status === "failed"
            ? (gen.generation.progress.message ?? "Couldn’t write a Story for you.")
            : runHere
              ? gen.error
              : null
        }
        onGenerate={startGeneration}
        onClose={() => setGenerateOpen(false)}
      />

      <Dialog open={confirmTarget !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this Story?</DialogTitle>
            <DialogDescription>
              {`“${confirmTarget?.title ?? ""}” goes away for good, along with its rating. Your Practice Records stay.`}
            </DialogDescription>
          </DialogHeader>
          {confirmTarget && view.error ? (
            <p role="alert" className="text-small text-destructive">{view.error}</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Keep
            </Button>
            <Button
              variant="destructive"
              disabled={view.pending}
              onClick={() => confirmTarget && void view.removeStory(confirmTarget.id)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The Library page's place in the whole: "1-20 of 57". */
function pageSummary(page: { items: unknown[]; total: number; limit: number; offset: number }): string {
  return `${page.offset + 1}-${Math.min(page.offset + page.items.length, page.total)} of ${page.total}`;
}

function readLayout(): "grid" | "list" {
  try {
    return window.localStorage.getItem(STORIES_LAYOUT_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

/** A filter chip (Unread | All): the pressed state is the selected state. */
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Button
      variant={active ? "secondary" : "outline"}
      aria-pressed={active}
      onClick={onPress}
    >
      {label}
    </Button>
  );
}

/**
 * A Library card: the Story Title links to the Reader, the English translation
 * stays hidden until revealed, and the menu carries Mark Read and Delete. The
 * rating lives in the Reader — the Library does not ask again.
 */
function StoryCard({
  story,
  revealed,
  onToggleReveal,
  onMarkRead,
  onMarkUnread,
  onAskDelete,
}: {
  story: Story;
  revealed: boolean;
  onToggleReveal: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onAskDelete: () => void;
}) {
  return (
    <Card className="gap-2 px-6" data-testid={`story-card-${story.id}`}>
      <div className="flex items-center gap-2">
        <Link
          to={`/stories/${story.id}`}
          aria-label={`Open story: ${story.title}`}
          className="min-w-0 flex-1 text-body font-semibold text-foreground hover:underline"
          data-testid={`story-open-${story.id}`}
        >
          {story.title}
        </Link>
        {story.readAt ? (
          <Badge variant="secondary" className="gap-1" data-testid={`story-read-${story.id}`}>
            <Check className="h-3.5 w-3.5" />
            Read
          </Badge>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${story.title}`}
              data-testid={`story-menu-${story.id}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={story.readAt ? onMarkUnread : onMarkRead} data-testid="menu-mark-read">
              {story.readAt ? <X /> : <Check />}
              {story.readAt ? "Mark unread" : "Mark read"}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={onAskDelete} data-testid="menu-delete">
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {story.titleEn ? (
        <button
          type="button"
          onClick={onToggleReveal}
          aria-expanded={revealed}
          aria-label={revealed ? undefined : "Show title translation"}
          className="self-start text-left text-small text-muted-foreground hover:underline"
          data-testid={`title-translation-${story.id}`}
        >
          {revealed ? story.titleEn : "Title translation hidden — click to show"}
        </button>
      ) : null}

      <p className="text-caption text-muted-foreground" data-testid={`story-meta-${story.id}`}>
        {`${genreLabel(story.genre) || "Story"} · ${originLabel(story)} · ${storyDate(story.createdAt)}`}
      </p>
    </Card>
  );
}

/**
 * The Generate dialog: an On-demand Story with optional Genre and Theme from
 * the server's suggestions, and the run's progress while it is being written.
 * Closing it never disturbs a run that is already going — the run lives on the
 * server and the pinned card keeps showing its bar.
 */
function GenerateDialog({
  open,
  suggestions,
  genre,
  theme,
  onGenreChange,
  onThemeChange,
  running,
  progressLabel,
  progressValue,
  error,
  onGenerate,
  onClose,
}: {
  open: boolean;
  suggestions: { genres: string[]; themes: string[] };
  genre: string | null;
  theme: string | null;
  onGenreChange: (genre: string | null) => void;
  onThemeChange: (theme: string | null) => void;
  running: boolean;
  progressLabel: string;
  progressValue: number;
  error: string | null;
  onGenerate: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate a Story</DialogTitle>
          <DialogDescription>
            One new Story now. Genre and Theme are optional — leave them on Any and the tutor chooses.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 text-small text-muted-foreground">
            Genre
            <select
              value={genre ?? ""}
              onChange={(event) => onGenreChange(event.target.value === "" ? null : event.target.value)}
              className="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-small text-foreground"
              data-testid="generate-genre-picker"
            >
              <option value="">Any genre</option>
              {suggestions.genres.map((option) => (
                <option key={option} value={option}>
                  {genreLabel(option) || option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-small text-muted-foreground">
            Theme
            <select
              value={theme ?? ""}
              onChange={(event) => onThemeChange(event.target.value === "" ? null : event.target.value)}
              className="h-9 max-w-56 rounded-md border border-input bg-background px-2 text-small text-foreground"
              data-testid="generate-theme-picker"
            >
              <option value="">Any theme</option>
              {suggestions.themes.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>

        {running ? (
          <div className="flex flex-col gap-2" data-testid="generate-progress">
            <ProgressStatus value={progressValue} label={progressLabel} />
            <p className="text-caption text-muted-foreground">It keeps writing if you close this dialog.</p>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-small text-destructive" data-testid="generate-error">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onGenerate} disabled={running} data-testid="generate-confirm">
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
