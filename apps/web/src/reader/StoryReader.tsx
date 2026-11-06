import type { ApiClient, Story, WeakSignalRequest } from "@vjt/api-client";
import {
  coveringSpan,
  grammarCue,
  holdSignal,
  menuOptions,
  saveableItem,
  storyCardMetaRuby,
  storyMetaEn,
  useEntryLookup,
  useItemLists,
  useReadingSettings,
  useT,
  type MenuOptionId,
  type StoryView,
  type TokenRef,
} from "@vjt/core";
import { Check, ChevronLeft, ChevronRight, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { T, TableText } from "@/components/Text.tsx";
import { ErrorState, SkeletonLines } from "@/components/states";
import { cn } from "@/lib/utils";
import { useStoryTextSize } from "../storysize/index.ts";
import { ReadingPanel, type LookTarget } from "./ReadingPanel.tsx";
import { DictionaryBody, GrammarBody, ReaderDialog, SaveBody } from "./Overlays.tsx";
import { StoryText, type StoryTextHandlers } from "./StoryText.tsx";

/**
 * The web Story reader (issue #77, ui-plan 4.1). It is the phone reader's
 * behaviour on a desktop page: the same Reading Panel rules, the same Lookup
 * copy and the same Weak Signals, with the input the browser has instead of a
 * touch hold:
 *
 *   hover or focus a word   the Reading Panel shows its Lookup;
 *   click (or Enter) a word a Lookup Menu opens next to it: Dictionary Entry,
 *                           Grammar (for a Grammar Span), Save, Save to…;
 *   Left / Right            move the selected sentence;
 *   Enter                   reveals the selected sentence's translation;
 *   Escape                  closes the menu or the dialog (Radix does it);
 *   Tab                     reaches every word that has a Dictionary Entry or
 *                           a Grammar Span.
 *
 * Everything the Story sends is rendered as React text, never as HTML.
 */

type DialogKind = "dictionary" | "grammar" | "save";
type Box = { left: number; top: number; width: number; height: number };

function sameRef(a: TokenRef | null, b: TokenRef): boolean {
  return a !== null && a.sentence === b.sentence && a.index === b.index;
}

/** The TokenRef a word span's `data-token` attribute names, or null. */
function tokenRefOf(el: Element | null | undefined): TokenRef | null {
  const m = el?.getAttribute("data-token")?.match(/^(\d+)-(\d+)$/);
  return m ? { sentence: Number(m[1]), index: Number(m[2]) } : null;
}

// How long the click of a press may take to consume that press's toggle mark.
const TOGGLE_MARK_MS = 1000;

export function StoryReader({ client, view, story }: { client: ApiClient; view: StoryView; story: Story }) {
  const navigate = useNavigate();
  const { language, tp } = useT();
  const { size } = useStoryTextSize();
  const reading = useReadingSettings(client);
  const lists = useItemLists(client);
  const lookup = useEntryLookup(client);

  const rootRef = useRef<HTMLDivElement>(null);
  const columnRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<TokenRef | null>(null);
  const [focused, setFocused] = useState<TokenRef | null>(null);
  const [menu, setMenu] = useState<{ ref: TokenRef; box: Box } | null>(null);
  const [dialog, setDialog] = useState<{ kind: DialogKind; ref: TokenRef } | null>(null);
  const [titleEnRevealed, setTitleEnRevealed] = useState(false);
  // The save notes are <T> elements, not resolved strings: they stay in the
  // Learner's language if it changes while on screen, and their furigana
  // survives (issue #125, the SyncCard pattern).
  const [saveNote, setSaveNote] = useState<ReactNode>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const saveBusyRef = useRef(false);
  const [saveError, setSaveError] = useState<ReactNode>(null);
  const [blurError, setBlurError] = useState<string | null>(null);
  // The word the last overlay belongs to: focus goes back there when it closes.
  const lastWord = useRef<TokenRef | null>(null);
  const keepFocusOnMenuClose = useRef(false);
  // The word marked at a fresh press (mousedown, click count 1) when its
  // already-open menu is about to be dismissed by that very press: the click
  // that follows closes (toggles) instead of reopening (issue #77 review).
  // The stamp keeps the mark to that one gesture: a press that drags away
  // never clicks, and its mark must not swallow a later click on the word.
  const wordToggle = useRef<{ ref: TokenRef; stamp: number } | null>(null);
  // The moment the press rule last ran, taken inside that listener. The gate
  // on a click's mark compares against this instead of reading a clock itself.
  const pressStamp = useRef(0);
  // Each (item, reason) is reported once per open Story; the server keeps only the
  // Learner's Known Items, so this is fire-and-forget.
  const signaled = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!saveNote) return;
    const fade = setTimeout(() => setSaveNote(null), 5000);
    return () => clearTimeout(fade);
  }, [saveNote]);

  const focusEntSeqs = useMemo(
    () => new Set((story.vocabItems ?? []).filter((v) => v.isFocus).map((v) => v.entSeq)),
    [story],
  );
  const blur = reading.state.status === "ready" ? reading.state.settings.blurTranslation : true;

  const tokenAt = (ref: TokenRef) => story.sentences[ref.sentence]?.tokens[ref.index];
  const spanAt = (ref: TokenRef) => {
    const sen = story.sentences[ref.sentence];
    const tok = sen?.tokens[ref.index];
    return sen && tok ? coveringSpan(sen, tok) : null;
  };

  const prime = (ref: TokenRef) => {
    const tok = tokenAt(ref);
    if (tok?.entSeq !== undefined) lookup.load(tok.entSeq, tok.surface, tok.reading);
  };

  // Hover and focus show a Lookup but never spend a request on a word whose last
  // lookup failed: sweeping the mouse down the sentence, or a menu closing and
  // its focus landing back on the word, must not refetch a 404 word over and
  // over (issue #77 review). A press — click, Enter, or the dialog's Retry —
  // still goes through and makes one fresh attempt.
  const primeUnlessFailed = (ref: TokenRef) => {
    const tok = tokenAt(ref);
    if (tok?.entSeq !== undefined && lookup.failed(tok.entSeq, tok.surface, tok.reading)) return;
    prime(ref);
  };

  const reportSignals = (signals: WeakSignalRequest[]) => {
    const fresh = signals.filter((s) => {
      const key = `${s.itemKind}|${s.itemRef}|${s.reason}`;
      if (signaled.current.has(key)) return false;
      signaled.current.add(key);
      return true;
    });
    if (fresh.length > 0) void lists.reportWeakSignals(fresh);
  };

  // Revealing a Sentence Translation signals the sentence's Focus Set items: the
  // Learner reached for the answer (issue #12).
  const onUnblur = (sentenceIdx: number) => {
    const sen = story.sentences[sentenceIdx];
    if (!sen) return;
    const inSentence = new Set(sen.tokens.flatMap((t) => (t.entSeq === undefined ? [] : [t.entSeq])));
    const signals: WeakSignalRequest[] = [];
    for (const v of story.vocabItems ?? []) {
      if (v.isFocus && v.entSeq !== undefined && inSentence.has(v.entSeq)) {
        signals.push({ itemKind: "vocabulary", itemRef: String(v.entSeq), reason: "translation_unblur" });
      }
    }
    for (const sp of sen.grammarSpans) {
      if (sp.isFocus) signals.push({ itemKind: "grammar", itemRef: sp.grammarPointId, reason: "translation_unblur" });
    }
    reportSignals(signals);
  };

  const toggleBlur = async () => {
    // Any attempt retires the previous failure, whether it comes from the row or Retry.
    setBlurError(null);
    const revealing = blur;
    const res = await reading.setBlurTranslation(!blur);
    setBlurError(res.ok ? null : res.message);
    if (res.ok && revealing && selected !== null) onUnblur(selected);
  };

  // --- the Lookup Menu ------------------------------------------------------

  const focusWord = (ref: TokenRef | null) => {
    if (!ref) return;
    columnRef.current?.querySelector<HTMLElement>(`[data-token="${ref.sentence}-${ref.index}"]`)?.focus();
  };

  const activate = (ref: TokenRef, element: HTMLElement, source: "pointer" | "keyboard") => {
    // Re-pressing the word whose menu is open closes it — a toggle, not a
    // close-and-reopen. A pointer press gets there first: the press rule (the
    // mousedown listener below) closed the menu at mousedown and marked the
    // word with its own moment, so the click of that same press closes while
    // a stale mark from a press that never clicked does not (issue #77 review).
    const mark = wordToggle.current;
    if (
      source === "pointer" &&
      mark !== null &&
      sameRef(mark.ref, ref) &&
      // The press rule stamps both `stamp` and `pressStamp` with the same
      // clock; the click of that press follows within TOGGLE_MARK_MS of it.
      pressStamp.current - mark.stamp <= TOGGLE_MARK_MS
    ) {
      wordToggle.current = null;
      closeMenu(); // a no-op when the press already closed it
      return;
    }
    if (source === "keyboard" && menu && sameRef(menu.ref, ref)) {
      closeMenu();
      return;
    }
    setSelected(ref.sentence);
    const tok = tokenAt(ref);
    if (!tok) return;
    const span = spanAt(ref);
    if (tok.entSeq === undefined && span === null) return; // nothing behind this word
    // A drag that selects text is a copying gesture, not a click: copying must
    // not open a menu. Enter on a word is never a selection gesture, so it is
    // not blocked (issue #77 review).
    if (source === "pointer" && window.getSelection()?.toString()) return;
    const column = columnRef.current;
    if (!column) return;
    const r = element.getBoundingClientRect();
    const c = column.getBoundingClientRect();
    lastWord.current = ref;
    setMenu({ ref, box: { left: r.left - c.left, top: r.top - c.top, width: r.width, height: r.height } });
    prime(ref);
    const signal = holdSignal(tok, span);
    if (signal) reportSignals([signal]);
  };

  const handlers: StoryTextHandlers = {
    onSelectSentence: (i) => setSelected(i),
    onTokenEnter: (ref) => {
      if (menu) return;
      setHovered(ref);
      primeUnlessFailed(ref);
    },
    onTokenLeave: (ref) => setHovered((cur) => (sameRef(cur, ref) ? null : cur)),
    onTokenFocus: (ref) => {
      setFocused(ref);
      setSelected(ref.sentence);
      primeUnlessFailed(ref);
    },
    onTokenBlur: (ref) => setFocused((cur) => (sameRef(cur, ref) ? null : cur)),
    onTokenActivate: activate,
  };

  // The panel follows the menu's word, then focus, then hover.
  const panelRef = menu?.ref ?? focused ?? hovered;
  const panelTarget: LookTarget | null = (() => {
    if (!panelRef) return null;
    const tok = tokenAt(panelRef);
    if (!tok) return null;
    const span = spanAt(panelRef);
    if (grammarCue(tok, span) === null && tok.entSeq === undefined) return null;
    // A particle with only a hint has no entry, so its Lookup is the grammar one.
    return { ...panelRef, kind: span || tok.entSeq === undefined ? "grammar" : "token" };
  })();

  const menuItems = (() => {
    if (!menu) return [];
    const tok = tokenAt(menu.ref);
    if (!tok) return [];
    const listsState = lists.state;
    const defaultName =
      listsState.status === "ready"
        ? listsState.lists.find((l) => l.id === listsState.defaultListId)?.name
        : undefined;
    const failed = tok.entSeq !== undefined && lookup.failed(tok.entSeq, tok.surface, tok.reading);
    return menuOptions(tok, spanAt(menu.ref), listsState.status === "ready", defaultName, failed, language);
  })();

  const closeMenu = () => setMenu(null);

  // Presses dismiss the menu on the reader's own rules, before any click runs
  // (issue #77 review, measured in Chromium — the browser counts presses on a
  // word in mousedown's `detail`):
  //  - a press inside the menu itself: nothing, its rows answer their click;
  //  - a fresh press (count 1) on the word that owns the menu: close it, and
  //    mark the word so the click that follows never reopens it — a toggle;
  //  - the second press of a double click (count 2) on that word: no press at
  //    all, so the menu the first click opened stays open;
  //  - any other press: close, like an ordinary outside click.
  useEffect(() => {
    if (menu === null) return;
    const menuRef = menu.ref;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (target?.closest?.('[data-slot="popover-content"]')) return;
      const ref = tokenRefOf(target?.closest?.("[data-token]"));
      if (ref !== null && sameRef(menuRef, ref)) {
        if (event.detail > 1) return;
        const stamp = Date.now();
        pressStamp.current = stamp;
        wordToggle.current = { ref: menuRef, stamp };
        closeMenu();
        return;
      }
      closeMenu();
    };
    document.addEventListener("mousedown", onMouseDown, true);
    return () => document.removeEventListener("mousedown", onMouseDown, true);
  }, [menu]);

  const saveInto = async (
    listId: string | null,
    item: { kind: "vocabulary" | "grammar"; ref: string },
    nameHint?: string,
  ) => {
    if (!listId) {
      setSaveNote(<T k="reader.saveListsLoading" />);
      return;
    }
    if (saveBusyRef.current) return; // one save at a time
    saveBusyRef.current = true;
    setSaveBusy(true);
    setSaveNote(null);
    try {
      const res = await lists.addToList(listId, { itemKind: item.kind, itemRef: item.ref });
      if (res.ok) {
        const found =
          lists.state.status === "ready" ? lists.state.lists.find((l) => l.id === listId)?.name : undefined;
        const listName = found ?? nameHint;
        // A known name is Learner data and fills the {list} slot; the fallback
        // "your list" is chrome, so it gets a whole-sentence key (issue #125).
        setSaveNote(
          listName ? (
            <T k="reader.savedToList" params={{ list: listName }} />
          ) : (
            <T k="reader.savedToListYours" />
          ),
        );
        setDialog(null);
        setSaveError(null);
      } else {
        setSaveNote(<T k="reader.saveFailed" params={{ message: res.message }} />);
      }
    } finally {
      saveBusyRef.current = false;
      setSaveBusy(false);
    }
  };

  const pick = (option: MenuOptionId) => {
    if (!menu) return;
    const { ref } = menu;
    const tok = tokenAt(ref);
    const span = spanAt(ref);
    closeMenu();
    if (!tok) return;
    if (option === "dictionary") {
      keepFocusOnMenuClose.current = true;
      setDialog({ kind: "dictionary", ref });
      return;
    }
    if (option === "grammar") {
      keepFocusOnMenuClose.current = true;
      setDialog({ kind: "grammar", ref });
      return;
    }
    const item = saveableItem(tok, span);
    if (!item) return;
    if (option === "save") {
      void saveInto(lists.state.status === "ready" ? lists.state.defaultListId : null, item);
      return;
    }
    keepFocusOnMenuClose.current = true;
    setSaveError(null);
    setDialog({ kind: "save", ref });
  };

  const closeDialog = () => {
    setDialog(null);
    setSaveError(null);
  };

  const createAndSave = (name: string) => {
    if (!dialog) return;
    const tok = tokenAt(dialog.ref);
    const item = tok ? saveableItem(tok, spanAt(dialog.ref)) : null;
    if (!item || saveBusyRef.current) return;
    saveBusyRef.current = true;
    setSaveBusy(true);
    void lists
      .createList({ name, boosting: false })
      .then(async (created) => {
        // Create-then-save: the save only follows a successful create.
        if (created.ok && created.list) {
          saveBusyRef.current = false;
          await saveInto(created.list.id, item, created.list.name);
          return;
        }
        setSaveError(
          created.ok ? (
            <T k="reader.saveFailedListVanished" />
          ) : (
            <T k="reader.saveFailed" params={{ message: created.message }} />
          ),
        );
      })
      .finally(() => {
        saveBusyRef.current = false;
        setSaveBusy(false);
      });
  };

  // --- keyboard -------------------------------------------------------------

  const moveSentence = (delta: number) => {
    const count = story.sentences.length;
    if (count === 0) return;
    const base = selected ?? (delta > 0 ? -1 : count);
    const next = Math.min(count - 1, Math.max(0, base + delta));
    setSelected(next);
    columnRef.current?.querySelector<HTMLElement>(`[data-sentence="${next}"]`)?.scrollIntoView?.({ block: "nearest" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Overlays are portalled but bubble through React; only keys pressed in the reader count.
    const target = e.target as HTMLElement;
    if (!rootRef.current?.contains(target) || e.defaultPrevented) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (target.closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      moveSentence(e.key === "ArrowLeft" ? -1 : 1);
      return;
    }
    // Enter reveals the translation; on a control or a word it does its own job.
    if (e.key === "Enter" && !target.closest("button, a, [data-token]") && selected !== null && blur) {
      e.preventDefault();
      void toggleBlur();
    }
  };

  // --- the footer's actions and the comprehension questions -----------------

  // The last Learner-initiated mutation (mark read, rating, answer): when it
  // fails, the bare message gets a Retry that repeats just that action
  // (ui-plan 5: a destructive message with one Retry, never a bare alert).
  const [lastAction, setLastAction] = useState<{ run: () => void } | null>(null);
  const run = (action: () => Promise<void>) => {
    const wrapped = { run: () => void action() };
    setLastAction(wrapped);
    wrapped.run();
  };

  const library = view.library.status === "ready" ? view.library.page.items : [];
  const at = library.findIndex((s) => s.id === story.id);
  const newer = at > 0 ? library[at - 1] : undefined;
  const older = at >= 0 && at < library.length - 1 ? library[at + 1] : undefined;

  const dialogTok = dialog ? tokenAt(dialog.ref) : undefined;
  const dialogSpan = dialog ? spanAt(dialog.ref) : null;
  const dialogEntry =
    dialogTok && dialogTok.entSeq !== undefined ? lookup.peek(dialogTok.entSeq, dialogTok.surface, dialogTok.reading) : undefined;
  const dialogFailed =
    dialogTok && dialogTok.entSeq !== undefined ? lookup.failed(dialogTok.entSeq, dialogTok.surface, dialogTok.reading) : false;
  const returnFocus = () => focusWord(lastWord.current);

  return (
    // One column for the whole reader (ui-plan 4.1): the title, panel, text, questions and
    // footer share the 40-character width, so their edges line up.
    <div
      ref={rootRef}
      onKeyDown={onKeyDown}
      data-testid="story-reader"
      className="story-column-width mx-auto flex flex-col gap-6"
    >
      <header className="flex flex-col gap-2">
        <Link to="/stories" className="inline-flex w-fit items-center gap-1 text-small text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" />
          <T k="reader.backToStories" />
        </Link>
        <h1 className="text-display font-semibold text-foreground">{story.title}</h1>
        {story.titleEn ? (
          <button
            type="button"
            aria-pressed={titleEnRevealed}
            onClick={() => setTitleEnRevealed((v) => !v)}
            className="w-fit rounded-sm text-left text-small text-muted-foreground hover:text-foreground"
          >
            <span className={cn(!titleEnRevealed && "blur-xs select-none")}>{story.titleEn}</span>
            <span className="ml-2 text-caption">
              {titleEnRevealed ? <T k="reader.hideTranslation" /> : <T k="reader.showTranslation" />}
            </span>
          </button>
        ) : null}
        {/* English keeps the pre-#125 Reader meta line byte-for-byte;
            Japanese speaks the same facts through the table. */}
        <p className="text-caption text-muted-foreground">
          {language === "en" ? (
            storyMetaEn(story)
          ) : (
            <TableText segments={storyCardMetaRuby(story, language)} />
          )}
        </p>
        {saveNote ? (
          <p role="status" className="text-small text-muted-foreground">
            {saveNote}
          </p>
        ) : null}
      </header>

      <ReadingPanel
        story={story}
        selected={selected}
        target={panelTarget}
        lookup={lookup}
        size={size}
        blur={blur}
        blurError={blurError}
        onToggleBlur={() => void toggleBlur()}
        onRetryBlur={() => void toggleBlur()}
      />

      <Popover open={menu !== null} onOpenChange={(open) => !open && closeMenu()}>
        <StoryText
          story={story}
          selected={selected}
          menuToken={menu?.ref ?? null}
          focusEntSeqs={focusEntSeqs}
          size={size}
          columnRef={columnRef}
          {...handlers}
        >
          <PopoverAnchor asChild>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute"
              style={
                menu
                  ? { left: menu.box.left, top: menu.box.top, width: menu.box.width, height: menu.box.height }
                  : { left: 0, top: 0, width: 0, height: 0 }
              }
            />
          </PopoverAnchor>
        </StoryText>
        <PopoverContent
          aria-label={tp("reader.wordMenuAria")}
          align="start"
          sideOffset={6}
          className="w-72"
          // The menu closes on the reader's own rules, not Radix's automatic
          // outside/focus dismiss (the effect above measures every press;
          // issue #77 review). Escape still lands on onOpenChange.
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onFocusOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            // A menu row that opened a dialog hands focus to the dialog instead.
            e.preventDefault();
            if (!keepFocusOnMenuClose.current) returnFocus();
            keepFocusOnMenuClose.current = false;
          }}
        >
          <ul className="flex flex-col">
            {menuItems.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  aria-label={option.label}
                  aria-describedby={option.hint ? `word-menu-hint-${option.id}` : undefined}
                  disabled={!option.enabled}
                  onClick={() => pick(option.id)}
                  className="flex min-h-11 w-full flex-col items-start justify-center rounded-md px-3 py-2 text-left text-body text-foreground hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:text-muted-foreground disabled:opacity-60"
                >
                  <span>{option.label}</span>
                  {option.hint ? (
                    <span id={`word-menu-hint-${option.id}`} className="text-caption text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      <ReaderDialog
        open={dialog?.kind === "dictionary"}
        onOpenChange={(open) => !open && closeDialog()}
        title={dialogEntry?.headword ?? dialogTok?.surface ?? tp("reader.dictionaryEntry")}
        description={tp("reader.dictionaryEntry")}
        testId="dictionary-window"
        onCloseAutoFocus={returnFocus}
      >
        {dialogEntry ? (
          <DictionaryBody entry={dialogEntry} />
        ) : dialogFailed && dialogTok?.entSeq !== undefined ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-body text-destructive">
              <T k="reader.dictNoAnswer" />
            </p>
            <Button
              variant="outline"
              onClick={() => {
                if (!dialogTok || dialogTok.entSeq === undefined) return;
                lookup.invalidate(dialogTok.entSeq, dialogTok.surface, dialogTok.reading);
                lookup.load(dialogTok.entSeq, dialogTok.surface, dialogTok.reading);
              }}
            >
              <T k="common.retry" />
            </Button>
          </div>
        ) : (
          <SkeletonLines lines={3} />
        )}
      </ReaderDialog>

      <ReaderDialog
        open={dialog?.kind === "grammar" && dialogSpan !== null}
        onOpenChange={(open) => !open && closeDialog()}
        title={dialogSpan?.pattern ?? tp("reader.grammarPoint")}
        description={tp("reader.grammarPoint")}
        testId="grammar-window"
        onCloseAutoFocus={returnFocus}
      >
        {dialogSpan ? <GrammarBody span={dialogSpan} /> : null}
      </ReaderDialog>

      <ReaderDialog
        open={dialog?.kind === "save"}
        onOpenChange={(open) => !open && closeDialog()}
        title={tp("reader.menu.saveTo")}
        description={tp("reader.saveToDescription")}
        testId="save-sheet"
        onCloseAutoFocus={returnFocus}
      >
        {lists.state.status === "ready" ? (
          <SaveBody
            lists={lists.state.lists}
            defaultListId={lists.state.defaultListId}
            busy={saveBusy}
            error={saveError}
            onSaveToList={(listId) => {
              if (!dialog) return;
              const tok = tokenAt(dialog.ref);
              const item = tok ? saveableItem(tok, spanAt(dialog.ref)) : null;
              if (item) void saveInto(listId, item);
            }}
            onCreateAndSave={createAndSave}
          />
        ) : (
          <SkeletonLines lines={3} />
        )}
      </ReaderDialog>

      {view.questions.length > 0 ? (
        <section aria-labelledby="comprehension-heading" className="flex flex-col gap-4 border-t border-border pt-6">
          <h2 id="comprehension-heading" className="text-small font-semibold tracking-wide text-muted-foreground uppercase">
            <T k="reader.comprehension" />
          </h2>
          {view.questions.map((q) => (
            <div key={q.position} className="flex flex-col gap-3">
              <p className="font-serif text-body text-foreground">{q.promptJa}</p>
              <div className="flex flex-wrap gap-2">
                {q.optionsJa.map((option, j) => (
                  <Button
                    key={j}
                    variant="outline"
                    aria-label={tp("reader.answerOption", { n: j + 1, option })}
                    disabled={q.result !== null}
                    onClick={() => run(() => view.answer(q.position, j))}
                    className="font-serif"
                  >
                    {option}
                  </Button>
                ))}
              </div>
              {q.result ? (
                <p className={q.result.correct ? "text-small text-success" : "text-small text-destructive"}>
                  {q.result.correct ? <T k="reader.correct" /> : <T k="reader.notQuite" />}
                </p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {view.error ? (
        <ErrorState message={view.error} onRetry={lastAction ? lastAction.run : undefined} />
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label={tp("reader.prevStoryAria")}
          disabled={!newer}
          onClick={() => newer && navigate(`/stories/${newer.id}`)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tp("reader.nextStoryAria")}
          disabled={!older}
          onClick={() => older && navigate(`/stories/${older.id}`)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          aria-label={story.readAt != null ? tp("reader.unmarkReadAria") : tp("stories.markRead")}
          aria-pressed={story.readAt != null}
          disabled={view.pending}
          onClick={() => run(() => (story.readAt != null ? view.clearRead(story.id) : view.setRead(story.id)))}
        >
          {story.readAt != null ? <Check aria-hidden="true" className="text-primary" /> : null}
          <T k="reader.read" />
        </Button>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={tp("reader.rateUpAria")}
            aria-pressed={story.rating === "up"}
            disabled={view.pending}
            onClick={() => run(() => view.rate(story.id, "up"))}
            className={cn(story.rating === "up" && "text-primary")}
          >
            <ThumbsUp aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={tp("reader.rateDownAria")}
            aria-pressed={story.rating === "down"}
            disabled={view.pending}
            onClick={() => run(() => view.rate(story.id, "down"))}
            className={cn(story.rating === "down" && "text-primary")}
          >
            <ThumbsDown aria-hidden="true" />
          </Button>
        </div>
        <Button asChild className="ml-auto">
          <Link to={`/practice?storyId=${encodeURIComponent(story.id)}`}>
            <T k="reader.practiceThis" />
          </Link>
        </Button>
      </footer>
    </div>
  );
}
