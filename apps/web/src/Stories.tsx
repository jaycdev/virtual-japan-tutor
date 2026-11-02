import type {
  ApiClient,
  DictionaryEntry,
  GrammarPointDetail,
  PitchPattern,
  Story as StoryData,
  StoryGrammarSpan,
  StorySettings,
  StoryToken,
  WeakSignalRequest,
} from "@vjt/api-client";
import { useItemLists, useReadingSettings, useStory, type ItemListsView, type StoryView } from "@vjt/core";
import { TimezoneAutocomplete } from "./TimezoneAutocomplete.tsx";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "./reader.css";

/**
 * Stories (issues #10, #32): the page opens on Today's Story — the newest
 * Automatic Story, which the background generator writes once per day in the
 * Learner's Timezone — with the Story Library one click away ("View all
 * stories"). Read stories (rate thumbs up/down to steer future genres),
 * answer the comprehension questions — the first answer writes Practice
 * Records for the story's Focus Set items — and choose the story settings
 * (Furigana Threshold, preferred genre/theme, and the Learner's Timezone).
 * Generation is never triggered from this screen, so opening a story is
 * instant; with no Automatic Story yet the panel says one is being written.
 * On-demand Stories live in the Library but are never Today's Story.
 *
 * The reader itself (issue #11) puts a fixed-size Reading Panel above the
 * story: tapping any word or punctuation selects its sentence (shown with
 * furigana from the story's tokens, and the translation blurred until
 * clicked — a preference remembered across sessions). Hovering or tabbing
 * to a word fills the single-line Lookup row with its reading, first
 * glosses, pitch graph and JLPT badge — instantly, from a cached lookup —
 * while Grammar Spans show their point's pattern and meaning instead. A
 * tapped word or Grammar Span token opens a menu (Dictionary · Save ·
 * Save to…; a span token's menu adds Grammar, so words inside a span keep
 * their own Dictionary Entry); Save targets the Default List — the token's
 * dictionary entry, or the Grammar Point when a dictionary-less token sits
 * in a span — and Save to… picks or creates any Item List (issue #12). Reader behaviour feeds Weak
 * Signals: holding a Known word's lookup past the configured threshold,
 * opening its Lookup Menu, opening a Grammar Span window, or unblurring a
 * Sentence Translation (one signal per Focus Set item in the sentence).
 * The Story Library (issue #31) is a table — Story Title (its English
 * translation blurred until clicked, a reveal that is never saved or
 * signalled), genre, stored theme, generation origin, created date, a Read
 * toggle, and a Delete that asks first (the Learner's rating goes with the
 * Story; Practice Records stay). A row click opens the reader, which shows
 * the Title, its blurred translation, and the same Read toggle.
 * Dictionary opens a Dictionary Entry window
 * with the full JMdict entry, the Learner's MaruMori state for the word and
 * each of its kanji, and the Kanjium pitch pattern when we have one.
 * Everything reachable by mouse is reachable by keyboard: tokens are
 * buttons, Enter opens the menu (which takes focus), Escape closes just the
 * menu — then the windows one at a time. Whichever way a menu or window
 * closes, focus goes back to the token button it came from.
 */
export function Stories({ client }: { client: ApiClient }) {
  const view = useStory(client);
  // Today's Story is the landing view; "View all stories" opens the Story
  // Library, and the reader's Back returns to whichever one it opened from.
  const [showLibrary, setShowLibrary] = useState(false);
  return (
    <section>
      <h2>Stories</h2>
      {view.error && (
        <p className="error" role="alert">
          {view.error}
        </p>
      )}
      {view.open && view.story ? (
        <StoryReader key={view.story.id} view={view} client={client} />
      ) : showLibrary ? (
        <StoryLibrary view={view} onBack={() => setShowLibrary(false)} />
      ) : (
        <TodaysStoryPanel view={view} onViewAll={() => setShowLibrary(true)} />
      )}
      <StorySettingsForm view={view} />
    </section>
  );
}

const sameLocalDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "today", "yesterday", or the weekday name — the Learner's local calendar. */
function localDayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameLocalDay(d, now)) return "today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(d, yesterday)) return "yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long" });
}

/** Which day today's slot is on: the ticket's "Still unread from Monday". */
function todayLine(s: StoryData): string {
  if (s.readAt) return `You read it ${localDayLabel(s.readAt)}.`;
  if (!sameLocalDay(new Date(s.createdAt), new Date())) return `Still unread from ${localDayLabel(s.createdAt)}.`;
  return "Written for you today.";
}

function TodaysStoryPanel({ view, onViewAll }: { view: StoryView; onViewAll: () => void }) {
  const t = view.today;
  return (
    <>
      {t.status === "loading" && <p className="muted">Writing today&apos;s story…</p>}
      {t.status === "story" && (
        <p>
          <button type="button" disabled={view.pending} onClick={() => void view.openStory(t.story.id)}>
            {t.story.readAt ? "Read today’s story again" : "Read today’s story"}
          </button>{" "}
          <span className="muted">{todayLine(t.story)}</span>
        </p>
      )}
      {t.status === "none" && (
        <p className="muted">
          No story yet — the tutor writes one for you every day.{" "}
          <button type="button" onClick={view.reloadToday}>
            Check again
          </button>
        </p>
      )}
      {t.status === "error" && (
        <p>
          Cannot load today&apos;s story: {t.message}{" "}
          <button type="button" onClick={view.reloadToday}>
            Retry
          </button>
        </p>
      )}
      <p>
        <button type="button" onClick={onViewAll}>
          View all stories
        </button>
      </p>
    </>
  );
}

function StoryLibrary({ view, onBack }: { view: StoryView; onBack: () => void }) {
  const lib = view.library;
  // Story Library (issue #31): the English title sits behind the same blur as
  // the Reading Panel's Sentence Translation, but revealing it is transient —
  // nothing is saved and no Weak Signal is recorded. Delete asks in-place
  // (like Settings' lists); a row click opens the reader.
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const toggleReveal = (id: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <>
      <p>
        <button type="button" onClick={onBack}>
          Back to today’s story
        </button>
      </p>
      {lib.status === "loading" && <p className="muted">Loading your stories…</p>}
      {lib.status === "error" && (
        <p>
          Cannot load your library: {lib.message}{" "}
          <button type="button" onClick={() => view.reload()}>
            Retry
          </button>
        </p>
      )}
      {lib.status === "ready" && lib.page.items.length === 0 && (
        <p className="muted">No stories yet. One will be waiting after the next generation pass.</p>
      )}
      {lib.status === "ready" && lib.page.items.length > 0 && (
        <table className="story-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Genre</th>
              <th>Theme</th>
              <th>Origin</th>
              <th>Created</th>
              <th>Read</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lib.page.items.map((s) => (
              <tr key={s.id} data-testid={`story-${s.id}`} onClick={() => void view.openStory(s.id)}>
                <td>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void view.openStory(s.id);
                    }}
                  >
                    {s.title}
                  </button>
                  {s.titleEn && (
                    <TitleTranslation
                      text={s.titleEn}
                      revealed={revealed.has(s.id)}
                      onToggle={() => toggleReveal(s.id)}
                    />
                  )}
                </td>
                <td>{s.genre}</td>
                <td>{s.theme || "—"}</td>
                <td>{s.origin === "on_demand" ? "On demand" : "Automatic"}</td>
                <td>{new Date(s.createdAt).toDateString()}</td>
                <td
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={s.readAt != null}
                    disabled={view.pending}
                    onClick={() => void (s.readAt != null ? view.clearRead(s.id) : view.setRead(s.id))}
                  >
                    Read
                  </button>
                </td>
                <td
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  {confirmingDelete === s.id ? (
                    <>
                      <button type="button" disabled={view.pending} onClick={() => void view.removeStory(s.id)}>
                        Confirm delete
                      </button>{" "}
                      <button type="button" onClick={() => setConfirmingDelete(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmingDelete(s.id)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lib.status === "ready" && (
        <p className="muted">
          {lib.page.offset + 1}–{Math.min(lib.page.offset + lib.page.items.length, lib.page.total)} of{" "}
          {lib.page.total}{" "}
          {lib.page.offset > 0 && (
            <button type="button" onClick={() => void view.loadPage(lib.page.offset - lib.page.limit)}>
              Previous
            </button>
          )}{" "}
          {lib.page.offset + lib.page.items.length < lib.page.total && (
            <button type="button" onClick={() => void view.loadPage(lib.page.offset + lib.page.limit)}>
              Next
            </button>
          )}
        </p>
      )}
    </>
  );
}

/**
 * The Story Title's English translation, blurred until clicked. Unlike the
 * Reading Panel's Sentence Translation the reveal is transient: it is never
 * saved as a setting and never reported as a Weak Signal (issue #31).
 */
function TitleTranslation({ text, revealed, onToggle }: { text: string; revealed: boolean; onToggle: () => void }) {
  return (
    <span
      className={`translation title-translation ${revealed ? "revealed" : "blurred"}`}
      role="button"
      tabIndex={0}
      title={revealed ? "Click to blur the translation" : "Translation is blurred — click to show it"}
      aria-pressed={revealed}
      onClick={(e) => {
        // Inside a library row the click must not bubble up and open the reader.
        e.stopPropagation();
        onToggle();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {text}
    </span>
  );
}

/** What the Lookup row is describing right now: a hovered/focused word, or a Grammar Span. */
type HoverTarget = { kind: "token"; sentence: number; index: number } | { kind: "grammar"; sentence: number; index: number };

/** The token a menu or window came from — focus returns there when it closes. */
type TokenRef = { sentence: number; index: number };

/** The token menu that is open (Dictionary · Save · Save to…), if any. */
type OpenMenu = TokenRef;

/** An open Dictionary Entry or Grammar Point window. */
type OpenWindow =
  | { kind: "dictionary"; key: string; entSeq: number; surface: string; reading?: string; by: TokenRef }
  | { kind: "grammar"; key: string; grammarPointId: string; by: TokenRef };

// The server's own lookup-hold default, used only while reading settings have
// not loaded yet (or failed) — same number the API seeds the column with.
const DEFAULT_LOOKUP_HOLD_MS = 800;

function StoryReader({ view, client }: { view: StoryView; client: ApiClient }) {
  const story = view.story as StoryData;
  const reading = useReadingSettings(client);
  const lists = useItemLists(client);
  const lookup = useEntryLookup(client);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [windows, setWindows] = useState<OpenWindow[]>([]);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  // The Story Title's translation is blurred in the reader too (issue #31),
  // and this reveal is transient as well — keying the reader per Story resets
  // it when the Learner moves on to another one.
  const [titleEnRevealed, setTitleEnRevealed] = useState(false);

  const openWindow = useCallback((w: OpenWindow) => {
    setWindows((prev) => (prev.some((x) => x.key === w.key) ? prev : [...prev, w]));
  }, []);

  // Focus must never fall to <body> when a menu or window closes: every path
  // that closes one hands focus back to the token button it came from.
  const focusToken = (at: TokenRef) => {
    document.querySelector<HTMLButtonElement>(`button[data-token="${at.sentence}:${at.index}"]`)?.focus();
  };

  // Weak Signals (issue #12): reader behaviour that hints a Known Item may be
  // shakier than its level says. Each (item, reason) pair is reported once per
  // open story; the server keeps only signals about the caller's Known Items
  // and drops the rest, so this is fire-and-forget.
  const signaled = useRef<Set<string>>(new Set());
  const reportSignals = (signals: WeakSignalRequest[]) => {
    const fresh = signals.filter((s) => {
      const key = `${s.itemKind}|${s.itemRef}|${s.reason}`;
      if (signaled.current.has(key)) return false;
      signaled.current.add(key);
      return true;
    });
    if (fresh.length > 0) void lists.reportWeakSignals(fresh);
  };

  // The Lookup Menu hold: a Known word whose Lookup row stays up past the
  // configured threshold signals a shakier word. The timer starts on hover
  // (or Tab) and dies on hover-out, on the menu opening (menu_open counts
  // instead), and on leaving the reader. A threshold of 0 signals every
  // lookup — the timer simply fires immediately.
  const holdMs = reading.state.status === "ready" ? reading.state.settings.lookupHoldMs : DEFAULT_LOOKUP_HOLD_MS;
  const holdTimer = useRef<number | null>(null);
  const cancelHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };
  const startHold = (token: StoryToken) => {
    cancelHold();
    if (token.tag !== "known" || token.entSeq === undefined) return;
    const entSeq = token.entSeq;
    holdTimer.current = window.setTimeout(() => {
      holdTimer.current = null;
      reportSignals([{ itemKind: "vocabulary", itemRef: String(entSeq), reason: "lookup" }]);
    }, holdMs);
  };
  useEffect(() => cancelHold, []);

  const onTokenActivate = (sentenceIdx: number, tokenIdx: number) => {
    const sentence = story.sentences[sentenceIdx];
    const token = sentence?.tokens[tokenIdx];
    if (!sentence || !token) return;
    setSelected(sentenceIdx);
    // Every token — plain word or one inside a Grammar Span — opens the same
    // menu, so words inside a span still reach their own Dictionary Entry;
    // the span's window hangs off a Grammar item the menu adds for it.
    if (menu && menu.sentence === sentenceIdx && menu.index === tokenIdx) {
      setMenu(null);
      return;
    }
    // Opening the Lookup Menu is itself a Weak Signal for the word (the
    // hold-timer signal would otherwise double up, so the timer dies here).
    cancelHold();
    if (token.entSeq !== undefined) {
      reportSignals([{ itemKind: "vocabulary", itemRef: String(token.entSeq), reason: "menu_open" }]);
    }
    setMenu({ sentence: sentenceIdx, index: tokenIdx });
  };

  // Unblurring a Sentence Translation signals its Focus Set items: the
  // Learner reached for the answer, so recognition of those items wobbled.
  // Only items actually in this sentence count; the server ignores any that
  // are not the caller's Known Items.
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

  // Save / Save to…: one item into one list — a word's dictionary entry, or
  // the Grammar Point behind a span token with no entry of its own. A plain
  // Save targets the Default List; the server records its own Weak Signal
  // when a Known Item lands in a Boosting List. The menu closes either way
  // and focus returns to the token.
  // `lists` goes through a ref: the click handler's closure may predate the
  // re-render that a create or save triggered, and must not read stale state.
  const listsRef = useRef(lists);
  useEffect(() => {
    listsRef.current = lists;
  }, [lists]);
  const saveItemToList = async (
    at: TokenRef,
    item: { kind: "vocabulary" | "grammar"; ref: string },
    listId: string | null,
    listName?: string,
  ) => {
    setMenu(null);
    focusToken(at);
    const view = listsRef.current;
    const target = listId ?? view.defaultListId;
    if (!target) {
      setSaveNote("Could not save — your Item Lists are not loaded.");
      return;
    }
    const res = await view.addToList(target, { itemKind: item.kind, itemRef: item.ref });
    if (!res.ok) {
      setSaveNote(`Could not save — ${res.message}`);
      return;
    }
    // The picker knows the name it chose (including a list it just created);
    // a plain Save reads the Default List's name from the latest state.
    const name =
      listName ?? (view.state.status === "ready" ? view.state.lists.find((l) => l.id === target)?.name : undefined);
    setSaveNote(name ? `Saved to ${name}.` : "Saved.");
  };

  const escape = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    // Escape peels one layer: it closes just the menu — focusing its token
    // button first, so focus is not dropped — and otherwise closes the most
    // recently opened window.
    if (menu) {
      focusToken(menu);
      setMenu(null);
    } else if (windows.length > 0) {
      const last = windows.at(-1);
      if (last) {
        focusToken(last.by);
        setWindows((prev) => prev.slice(0, -1));
      }
    }
  };

  return (
    <section onKeyDown={escape}>
      <p>
        <button type="button" onClick={view.close}>
          ← Back
        </button>
      </p>
      <h3>
        {story.title}{" "}
        {story.titleEn && (
          <TitleTranslation
            text={story.titleEn}
            revealed={titleEnRevealed}
            onToggle={() => setTitleEnRevealed((v) => !v)}
          />
        )}{" "}
        <span className="muted">
          {story.genre} · {new Date(story.createdAt).toDateString()}
        </span>
      </h3>
      <p>
        <button
          type="button"
          aria-pressed={story.readAt != null}
          onClick={() => void (story.readAt != null ? view.clearRead(story.id) : view.setRead(story.id))}
        >
          Read
        </button>{" "}
        <RatingButtons view={view} story={story} />
      </p>

      <ReadingPanel
        story={story}
        selected={selected}
        hovered={hovered}
        lookup={lookup}
        reading={reading}
        onUnblur={onUnblur}
      />
      {saveNote && (
        <p className={saveNote.startsWith("Could not") ? "error" : "saved"} role="status">
          {saveNote}
        </p>
      )}

      {story.sentences.map((sen, i) => {
        // A hovered Grammar Span lights up every token it covers, not just the
        // one the pointer is on — the whole span reads as one unit.
        const hoverToken =
          hovered && hovered.kind === "grammar" && hovered.sentence === i ? sen.tokens[hovered.index] : undefined;
        const hoverSpan = hoverToken ? coveringSpan(sen, hoverToken) : null;
        return (
        <p key={i} className="story-sentence" onClick={() => setSelected(i)}>
          <SentenceText
            sentence={sen}
            tokens={sen.tokens}
            renderToken={(tok, j) => (
              <TokenButton
                key={j}
                token={tok}
                tokenKey={`${i}:${j}`}
                spans={sen.grammarSpans}
                hovered={
                  (hovered?.kind === "token" && hovered.sentence === i && hovered.index === j) ||
                  (hoverSpan !== null && coveringSpan(sen, tok) === hoverSpan)
                }
                onEnter={() => {
                  setHovered({ kind: coveringSpan(sen, tok) ? "grammar" : "token", sentence: i, index: j });
                  if (coveringSpan(sen, tok) === null && tok.entSeq !== undefined) {
                    lookup.load(tok.entSeq, tok.surface, tok.reading);
                    startHold(tok);
                  }
                }}
                onLeave={() => {
                  cancelHold();
                  setHovered((h) => (h && h.sentence === i && h.index === j ? null : h));
                }}
                onActivate={() => onTokenActivate(i, j)}
                menu={
                  menu && menu.sentence === i && menu.index === j ? (
                    <TokenMenu
                      token={tok}
                      span={coveringSpan(sen, tok)}
                      lists={lists}
                      onSave={(listId, name) => {
                        const sp = coveringSpan(sen, tok);
                        if (tok.entSeq !== undefined)
                          void saveItemToList(
                            { sentence: i, index: j },
                            { kind: "vocabulary", ref: String(tok.entSeq) },
                            listId,
                            name,
                          );
                        else if (sp)
                          void saveItemToList(
                            { sentence: i, index: j },
                            { kind: "grammar", ref: sp.grammarPointId },
                            listId,
                            name,
                          );
                      }}
                      onDictionary={() => {
                        if (tok.entSeq === undefined) return;
                        setMenu(null);
                        // The menu closes to make way for the window: the token
                        // button keeps focus.
                        focusToken({ sentence: i, index: j });
                        openWindow({
                          kind: "dictionary",
                          key: `entry-${tok.entSeq}-${tok.surface}`,
                          entSeq: tok.entSeq,
                          surface: tok.surface,
                          reading: tok.reading,
                          by: { sentence: i, index: j },
                        });
                      }}
                      onGrammar={() => {
                        const sp = coveringSpan(sen, tok);
                        if (!sp) return;
                        setMenu(null);
                        focusToken({ sentence: i, index: j });
                        // Opening a Grammar Point window is the span's menu-open
                        // signal; the server drops it unless the point is known.
                        reportSignals([{ itemKind: "grammar", itemRef: sp.grammarPointId, reason: "menu_open" }]);
                        openWindow({
                          kind: "grammar",
                          key: `grammar-${sp.grammarPointId}`,
                          grammarPointId: sp.grammarPointId,
                          by: { sentence: i, index: j },
                        });
                      }}
                    />
                  ) : null
                }
              />
            )}
          />
        </p>
        );
      })}

      {windows.map((w) =>
        w.kind === "dictionary" ? (
          <DictionaryWindow
            key={w.key}
            client={client}
            entry={w}
            cached={lookup.peek(w.entSeq, w.surface, w.reading)}
            onClose={() => {
              setWindows((prev) => prev.filter((x) => x.key !== w.key));
              focusToken(w.by);
            }}
          />
        ) : (
          <GrammarWindow
            key={w.key}
            client={client}
            grammarPointId={w.grammarPointId}
            onClose={() => {
              setWindows((prev) => prev.filter((x) => x.key !== w.key));
              focusToken(w.by);
            }}
          />
        ),
      )}

      <h4>Comprehension</h4>
      {view.questions.map((q) => {
        const settled = q.result !== null;
        return (
          <div key={q.position} className="question">
            <p>
              <strong>{q.promptJa}</strong>
            </p>
            {q.result && (
              <p className={q.result.correct ? "saved" : "error"} role="status">
                {q.result.correct ? "Correct" : "Not quite"}
                {q.result.practiceRecorded && " — practised your focus words"}
              </p>
            )}
            <ul className="option-list">
              {q.optionsJa.map((opt, idx) => (
                <li key={idx}>
                  <button
                    type="button"
                    disabled={settled || view.pending}
                    onClick={() => void view.answer(q.position, idx)}
                  >
                    {opt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/**
 * The Reading Panel: fixed size, stuck to the top while the story scrolls.
 * The selected sentence (with furigana) and its translation live in a
 * fixed two-line area — long text first shrinks one step, then scrolls
 * internally — so the panel never changes size; the Lookup row below it is
 * a single line, always led by the fixed "Word meaning" label.
 */
function ReadingPanel({
  story,
  selected,
  hovered,
  lookup,
  reading,
  onUnblur,
}: {
  story: StoryData;
  selected: number | null;
  hovered: HoverTarget | null;
  lookup: EntryLookup;
  reading: ReturnType<typeof useReadingSettings>;
  /** Reports Weak Signals when a blurred Sentence Translation is revealed. */
  onUnblur: (sentenceIdx: number) => void;
}) {
  const blur = reading.state.status === "ready" ? reading.state.settings.blurTranslation : true;
  const sen = selected !== null ? story.sentences[selected] : null;
  const [blurError, setBlurError] = useState<string | null>(null);

  // A failed save leaves the stored preference — and the screen — as they
  // were; the only change is the message that says the click did not stick.
  // A *successful* reveal is a Weak Signal for the sentence's Focus Set
  // items (issue #12): the Learner reached for the answer.
  const toggleBlur = async () => {
    const revealing = blur;
    const res = await reading.setBlurTranslation(!blur);
    setBlurError(res.ok ? null : res.message);
    if (res.ok && revealing && selected !== null) onUnblur(selected);
  };

  // Two lines don't fit (long sentence, furigana ruby inflating the lines)?
  // Shrink the text exactly one step; if it still overflows, the area scrolls.
  // The measurement runs once per selected sentence, always with `.shrunk`
  // removed first, and the class is never taken back while the content stands
  // — so hover re-renders cannot bounce the text between sizes. The shrink
  // lives on the inner .sentence-content wrapper: the box's own em height is
  // tied to the panel's font size, not to the shrunken text, so it never moves.
  return (
    <div className="reading-panel" aria-label="Reading Panel">
      <div
        className="sentence-area"
        ref={(el) => {
          if (!el) return;
          const measured = String(selected);
          if (el.dataset.measured === measured) return;
          el.dataset.measured = measured;
          el.classList.remove("shrunk");
          if (el.scrollHeight > el.clientHeight) el.classList.add("shrunk");
        }}
      >
        <span className="sentence-content">
          {sen ? (
            <>
              <span className="panel-sentence">
                <SentenceText sentence={sen} tokens={sen.tokens} renderToken={(tok, j) => <TokenRuby key={j} token={tok} />} />
              </span>{" "}
              <span
                className={`translation ${blur ? "blurred" : "revealed"}`}
                role="button"
                tabIndex={0}
                title={blur ? "Translation is blurred — click to show it" : "Click to blur the translation"}
                aria-pressed={!blur}
                onClick={() => void toggleBlur()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    void toggleBlur();
                  }
                }}
              >
                {sen.en}
              </span>
              {reading.state.status === "error" && (
                <span className="muted"> (reading settings unavailable — {reading.state.message})</span>
              )}
            </>
          ) : (
            <span className="muted">Tap a word or punctuation to select its sentence.</span>
          )}
        </span>
      </div>
      <div className="lookup-row" aria-live="polite">
        {/* Fixed label, outside the conditional content: it keeps its slot so
            the row never shifts as lookups come and go. */}
        <span className="lookup-label">Word meaning</span>
        <LookupRow story={story} hovered={hovered} lookup={lookup} />
      </div>
      {blurError && (
        <p className="error" role="alert">
          Could not save that — {blurError}
        </p>
      )}
    </div>
  );
}

/**
 * The single Lookup row line. A word: the word in blue, its reading in
 * orange, the first two glosses ("…" when the entry has more), and on the
 * right the pitch graph then the JLPT badge — all from the cached entry the
 * hover triggered, so repeat hovers are instant. A Grammar Span instead
 * shows the Grammar Point's pattern and meaning straight from the story
 * payload — no request needed.
 */
function LookupRow({
  story,
  hovered,
  lookup,
}: {
  story: StoryData;
  hovered: HoverTarget | null;
  lookup: EntryLookup;
}) {
  if (!hovered) return <span className="muted">Hover or Tab to a word to look it up.</span>;
  const sen = story.sentences[hovered.sentence];
  if (!sen) return null;
  if (hovered.kind === "grammar") {
    const token = sen.tokens[hovered.index];
    const span = token ? coveringSpan(sen, token) : null;
    if (!span) return null;
    return (
      <>
        <span className="lookup-word">{span.pattern}</span>
        <span className="lookup-glosses">{span.meaning}</span>
        <span className="lookup-right">
          <JlptBadge level={span.jlptLevel} />
        </span>
      </>
    );
  }
  const token = sen.tokens[hovered.index];
  if (!token) return null;
  const entry = token.entSeq !== undefined ? lookup.peek(token.entSeq, token.surface, token.reading) : undefined;
  // Until the entry arrives, a story Focus Set item already has a gloss to show.
  const seedGloss = entry ? undefined : story.vocabItems?.find((v) => v.entSeq === token.entSeq)?.en;
  const glosses = entry ? firstGlosses(entry, 2) : seedGloss ? [seedGloss] : [];
  const more = entry ? countGlosses(entry) > glosses.length : false;
  return (
    <>
      <span className="lookup-word">{token.surface}</span>
      {token.reading && token.reading !== token.surface && <span className="lookup-reading">{token.reading}</span>}
      {glosses.length > 0 && (
        <span className="lookup-glosses">
          {glosses.join(", ")}
          {more ? "…" : ""}
        </span>
      )}
      <span className="lookup-right">
        {entry?.pitch && <PitchGraph pitch={entry.pitch} />}
        {entry?.jlptLevel && <JlptBadge level={entry.jlptLevel} />}
      </span>
    </>
  );
}

/**
 * The menu over a tapped word or Grammar Span token. Dictionary is the
 * word's own entry; a token inside a Grammar Span also gets a Grammar item
 * for the point, keeping words inside spans reachable. Save puts the token's
 * item in the Default List (Saved unless the Learner chose another): its
 * dictionary entry when it has one, and the Grammar Point when a
 * dictionary-less token sits inside a Span — so a Grammar Point is saveable
 * from the reader too. Save to… opens a picker of every Item List with an
 * inline "new list" row, and creating a list saves the item straight into
 * it. Either Save closes the menu and hands focus back to the token. Opening
 * moves focus to the first enabled item.
 */
function TokenMenu({
  token,
  span,
  lists,
  onSave,
  onDictionary,
  onGrammar,
}: {
  token: StoryToken;
  span: StoryGrammarSpan | null;
  lists: ItemListsView;
  /** Save this token into `listId` (named `name`), or the Default List when null. */
  onSave: (listId: string | null, name?: string) => void;
  onDictionary: () => void;
  onGrammar: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])");
    first?.focus();
  }, []);

  const ready = lists.state.status === "ready";
  const state = lists.state;
  const defaultName =
    state.status === "ready"
      ? state.lists.find((l) => l.id === state.defaultListId)?.name
      : undefined;
  // What Save targets: the token's own dictionary entry when it has one,
  // otherwise the Grammar Point of the Span covering it. Only a token with
  // neither is unsaveable.
  const linked = token.entSeq !== undefined;
  const saveable = linked || span !== null;
  const unsaveableTitle = "This word did not match a dictionary entry";
  const saveTitle = saveable
    ? ready
      ? linked
        ? `Save to ${defaultName ?? "the default list"}`
        : `Save the grammar point ${span?.pattern ?? ""} to ${defaultName ?? "the default list"}`
      : "Your Item Lists are still loading"
    : unsaveableTitle;

  const createAndSave = async (e: FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setCreateError(null);
    const created = await lists.createList({ name, boosting: false });
    // Only save once the list genuinely exists — a failed create must not
    // silently aim the item at some other list.
    if (created.ok) {
      if (created.list) onSave(created.list.id, created.list.name);
      else setCreateError("The new list was created but could not be read back.");
    } else setCreateError(created.message);
  };

  return (
    <span ref={rootRef} className="token-menu" role="menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        role="menuitem"
        disabled={token.entSeq === undefined}
        title={token.entSeq === undefined ? "This word did not match a dictionary entry" : undefined}
        onClick={onDictionary}
      >
        Dictionary
      </button>
      {span && (
        <button type="button" role="menuitem" title={`${span.pattern}: ${span.meaning}`} onClick={onGrammar}>
          Grammar
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={!saveable || !ready}
        title={saveTitle}
        onClick={() => onSave(null)}
      >
        Save
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!saveable || !ready}
        title={ready ? "Save into another Item List" : "Your Item Lists are still loading"}
        onClick={() => setPicking(true)}
      >
        Save to…
      </button>
      {picking && (
        <span className="token-menu-picker" onClick={(e) => e.stopPropagation()}>
          {lists.state.status === "ready" &&
            lists.state.lists.map((l) => (
              <button key={l.id} type="button" role="menuitem" onClick={() => onSave(l.id, l.name)}>
                {l.name}
                {l.isDefault ? " (default)" : ""}
              </button>
            ))}
          <form onSubmit={(e) => void createAndSave(e)}>
            <input
              name="newListName"
              maxLength={60}
              placeholder="new list name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />{" "}
            <button type="submit" role="menuitem" disabled={newName.trim() === ""}>
              Create and save
            </button>
          </form>
          {createError && (
            <span className="error" role="alert">
              {createError}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

/** A floating Dictionary Entry window. */
function DictionaryWindow({
  client,
  entry,
  cached,
  onClose,
}: {
  client: ApiClient;
  entry: { entSeq: number; surface: string; reading?: string };
  cached: DictionaryEntry | undefined;
  onClose: () => void;
}) {
  const [data, setData] = useState<DictionaryEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The window loads its own copy when the hover has not filled the cache
    // yet. If the hover's fetch then lands, `cached` changes, this effect
    // re-runs, and the window's now-duplicate request is simply dropped.
    if (cached) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data: got, error: err } = await client.GET("/dictionary/entries/{entSeq}", {
          params: {
            path: { entSeq: String(entry.entSeq) },
            query: { surface: entry.surface, reading: entry.reading },
          },
        });
        if (cancelled) return;
        if (got) setData(got);
        else setError(err?.message ?? "Cannot load this entry");
      } catch {
        if (!cancelled) setError("Cannot reach the server");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, entry.entSeq, entry.surface, entry.reading, cached]);

  // Derived, never staged: the cached entry shows whenever it arrives — before
  // or even after this window's own request began — and "Loading…" only while
  // there is nothing to show and nothing has failed.
  const shown = cached ?? data;

  return (
    <section className="entry-window" aria-label={`Dictionary entry: ${entry.surface}`}>
      <p className="entry-head">
        <strong>{shown?.headword ?? entry.surface}</strong>
        {shown?.reading && shown.reading !== shown.headword && <span className="lookup-reading"> {shown.reading}</span>}
        {shown?.jlptLevel && <JlptBadge level={shown.jlptLevel} />}
        <button type="button" aria-label="Close entry window" onClick={onClose}>
          ×
        </button>
      </p>
      {!shown && !error && <p className="muted">Loading entry…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {shown && !shown.found && <p className="muted">The dictionary has no entry behind this word.</p>}
      {shown && shown.found && (
        <>
          {shown.srsLevel !== null && (
            <p className="entry-srs">
              Known item — SRS Level {shown.srsLevel}, Mastery {Math.round((shown.mastery ?? 0) * 100)}%
            </p>
          )}
          <ol className="senses">
            {shown.senses.map((sense, i) => (
              <li key={i}>
                {sense.partsOfSpeech.length > 0 && <em className="pos">{sense.partsOfSpeech.join(", ")} — </em>}
                {sense.glosses.join("; ")}
              </li>
            ))}
          </ol>
          {shown.kanjiForms.length > 0 && <p className="forms">Kanji forms: {shown.kanjiForms.join("、")}</p>}
          {shown.readings.length > 0 && <p className="forms">Readings: {shown.readings.join("、")}</p>}
          {shown.pitch && (
            <p className="pitch-row">
              Pitch <PitchGraph pitch={shown.pitch} />{" "}
              <span className="muted">
                {shown.pitch.heiban ? "heiban (flat)" : `downstep after mora ${shown.pitch.downstepAfterMora}`}
              </span>
            </p>
          )}
          {shown.kanji.length > 0 && (
            <table className="kanji-table">
              <caption>Kanji in this word</caption>
              <tbody>
                {shown.kanji.map((k) => (
                  <tr key={k.literal}>
                    <td>{k.literal}</td>
                    <td>{k.known ? "known" : "new"}</td>
                    <td>{k.srsLevel !== null ? `SRS ${k.srsLevel}` : ""}</td>
                    <td>{k.mastery !== null ? `${Math.round(k.mastery * 100)}%` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

/** A floating Grammar Point window: explanation and examples from the catalogue. */
function GrammarWindow({
  client,
  grammarPointId,
  onClose,
}: {
  client: ApiClient;
  grammarPointId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<GrammarPointDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: got, error: err } = await client.GET("/grammar/points/{id}", {
          params: { path: { id: grammarPointId } },
        });
        if (cancelled) return;
        if (got) setData(got);
        else setError(err?.message ?? "Cannot load this grammar point");
      } catch {
        if (!cancelled) setError("Cannot reach the server");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, grammarPointId]);

  return (
    <section className="entry-window" aria-label={`Grammar point ${grammarPointId}`}>
      <p className="entry-head">
        <strong>{data?.pattern ?? `Grammar point ${grammarPointId}`}</strong>
        {data && <JlptBadge level={data.jlptLevel} />}
        <button type="button" aria-label="Close grammar window" onClick={onClose}>
          ×
        </button>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <p>{data.meaning}</p>
          {data.explanation ? (
            <p className="explanation" style={{ whiteSpace: "pre-line" }}>
              {data.explanation}
            </p>
          ) : (
            <p className="muted">No explanation for this point yet.</p>
          )}
          {data.examples.length > 0 && (
            <ul className="examples">
              {data.examples.map((ex) => (
                <li key={ex.id}>
                  <span>
                    {ex.sentenceJa.slice(0, ex.spanStart)}
                    <mark>{ex.sentenceJa.slice(ex.spanStart, ex.spanEnd)}</mark>
                    {ex.sentenceJa.slice(ex.spanEnd)}
                  </span>{" "}
                  <span className="muted">{ex.translationEn}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The mora pitch graph, drawn from Kanjium numbers only when we have them:
 * a filled dot per mora joined by lines to a hollow dot for the following
 * particle. Heiban (flat): mora 1 low, everything after — the particle
 * included — high. Downstep: high up to the accent mora, low from there,
 * particle low too.
 */
function PitchGraph({ pitch }: { pitch: PitchPattern }) {
  const w = 10;
  const high = 3;
  const low = 15;
  const y = (m: number) => (pitch.heiban ? (m === 1 ? low : high) : m <= pitch.accentPosition ? high : low);
  const n = pitch.moraCount;
  const moras = Array.from({ length: n }, (_, i) => ({ x: i * w, y: y(i + 1) }));
  const particle = { x: n * w, y: y(n + 1) };
  const line = [...moras, particle].map((p) => `${p.x},${p.y}`).join(" ");
  return (
    <svg
      className="pitch-graph"
      width={n * w + 8}
      height={18}
      role="img"
      aria-label={`Pitch pattern for ${pitch.reading}`}
    >
      <polyline points={line} fill="none" stroke="#1a56db" strokeWidth={1.5} />
      {moras.map((p, i) => (
        <circle key={i} className="pitch-mora" cx={p.x} cy={p.y} r={2.5} fill="#1a56db" />
      ))}
      <circle className="pitch-particle" cx={particle.x} cy={particle.y} r={2.5} fill="#fff" stroke="#1a56db" strokeWidth={1.5} />
    </svg>
  );
}

function JlptBadge({ level }: { level: string }) {
  return <span className="jlpt-badge">{level}</span>;
}

function countGlosses(entry: DictionaryEntry): number {
  return entry.senses.reduce((n, s) => n + s.glosses.length, 0);
}

function firstGlosses(entry: DictionaryEntry, n: number): string[] {
  const out: string[] = [];
  for (const sense of entry.senses) {
    for (const g of sense.glosses) {
      out.push(g);
      if (out.length >= n) return out;
    }
  }
  return out;
}

/**
 * Cached on-demand dictionary lookups powering the Lookup row. Hovering a
 * word fetches its entry (keyed by entSeq + the tapped form so the echoed
 * headword and the reading's pitch are right) and caches it; repeated hovers
 * and the Dictionary window then need no new request. Failures are cached as
 * a null entry too, so hovering a word with no dictionary row does not hit
 * the server over and over.
 */
interface EntryLookup {
  load(entSeq: number, surface?: string, reading?: string): void;
  peek(entSeq: number, surface?: string, reading?: string): DictionaryEntry | undefined;
}

function useEntryLookup(client: ApiClient): EntryLookup {
  const [cache, setCache] = useState<Map<string, DictionaryEntry | null>>(() => new Map());
  const inflight = useRef<Set<string>>(new Set());

  const key = (entSeq: number, surface?: string, reading?: string) => `${entSeq}|${surface ?? ""}|${reading ?? ""}`;

  const load = useCallback(
    (entSeq: number, surface?: string, reading?: string) => {
      const k = key(entSeq, surface, reading);
      if (cache.has(k) || inflight.current.has(k)) return;
      inflight.current.add(k);
      void (async () => {
        try {
          const { data } = await client.GET("/dictionary/entries/{entSeq}", {
            params: { path: { entSeq: String(entSeq) }, query: { surface, reading } },
          });
          setCache((prev) => new Map(prev).set(k, data ?? null));
        } catch {
          setCache((prev) => new Map(prev).set(k, null));
        } finally {
          inflight.current.delete(k);
        }
      })();
    },
    [client, cache],
  );

  const peek = useCallback((entSeq: number, surface?: string, reading?: string) => {
    return cache.get(key(entSeq, surface, reading)) ?? undefined;
  }, [cache]);

  return { load, peek };
}

/** The Grammar Span covering this token, if any. */
function coveringSpan(sentence: StoryData["sentences"][number], token: StoryToken): StoryGrammarSpan | null {
  for (const sp of sentence.grammarSpans) {
    if (token.start < sp.end && sp.start < token.end) return sp;
  }
  return null;
}

/**
 * Renders a sentence's tokens in order, splicing in any characters the
 * tokeniser left out (punctuation) as plain text, using the codepoint
 * offsets both the server and String iterators agree on for this text.
 */
function SentenceText({
  sentence,
  tokens,
  renderToken,
}: {
  sentence: StoryData["sentences"][number];
  tokens: StoryToken[];
  renderToken: (token: StoryToken, index: number) => ReactNode;
}) {
  const chars = Array.from(sentence.ja);
  const out: ReactNode[] = [];
  let cursor = 0;
  tokens.forEach((tok, j) => {
    if (tok.start > cursor) out.push(<span key={`gap-${j}`}>{chars.slice(cursor, tok.start).join("")}</span>);
    out.push(renderToken(tok, j));
    cursor = Math.max(cursor, tok.end);
  });
  if (cursor < chars.length) out.push(<span key="gap-end">{chars.slice(cursor).join("")}</span>);
  return <>{out}</>;
}

/** A token in the Reading Panel: ruby reading when the server asked for furigana. */
function TokenRuby({ token }: { token: StoryToken }) {
  if (token.showFurigana && token.reading) {
    return (
      <ruby>
        {token.surface}
        <rt>{token.reading}</rt>
      </ruby>
    );
  }
  return <span>{token.surface}</span>;
}

/**
 * A token in the story body: a real button so Tab reaches every word and
 * Enter opens its menu. Underline rules: solid = Known Item, dotted =
 * unknown with a dictionary entry, none = unlinked; Grammar Spans override
 * with a purple wavy line (thicker still for the story's focus grammar).
 */
function TokenButton({
  token,
  tokenKey,
  spans,
  hovered,
  onEnter,
  onLeave,
  onActivate,
  menu,
}: {
  token: StoryToken;
  tokenKey: string;
  spans: StoryGrammarSpan[];
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onActivate: () => void;
  menu: ReactNode;
}) {
  const covered = spans.filter((sp) => token.start < sp.end && sp.start < token.end);
  const cls = ["token"];
  if (covered.length > 0) {
    cls.push("tok-grammar");
    if (covered.some((sp) => sp.isFocus)) cls.push("tok-grammar-focus");
  } else if (token.tag === "known") {
    cls.push("tok-known");
  } else if (token.entSeq !== undefined) {
    cls.push("tok-dotted");
  } else {
    cls.push("tok-plain");
  }
  if (hovered) cls.push("is-hovered");
  const title = covered.map((sp) => `${sp.pattern}: ${sp.meaning}`).join(" / ") || undefined;
  return (
    <span className="token-wrap">
      <button
        type="button"
        className={cls.join(" ")}
        data-token={tokenKey}
        title={title}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onFocus={onEnter}
        onBlur={onLeave}
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
      >
        <TokenRuby token={token} />
      </button>
      {menu}
    </span>
  );
}

function RatingButtons({ view, story }: { view: StoryView; story: StoryData }) {
  return (
    <span className="rating">
      <button
        type="button"
        aria-pressed={story.rating === "up"}
        disabled={view.pending}
        onClick={() => void view.rate(story.id, "up")}
      >
        👍
      </button>
      <button
        type="button"
        aria-pressed={story.rating === "down"}
        disabled={view.pending}
        onClick={() => void view.rate(story.id, "down")}
      >
        👎
      </button>
    </span>
  );
}

/** The Furigana Threshold, preferred genre/theme, and the Learner's Timezone. */
function StorySettingsForm({ view }: { view: StoryView }) {
  const s = view.settings;
  return (
    <section>
      <h3>Story settings</h3>
      {s.status === "loading" && <p className="muted">Loading your story settings…</p>}
      {s.status === "error" && (
        <p>
          Cannot load your story settings: {s.message}{" "}
          <button type="button" onClick={view.reloadSettings}>
            Retry
          </button>
        </p>
      )}
      {s.status === "ready" && <StorySettingsFields view={view} stored={s.settings} />}
    </section>
  );
}

/**
 * The form itself. Local edits overlay the stored settings; a successful
 * save clears the overlay, so the fields then show the server's answer.
 */
function StorySettingsFields({ view, stored }: { view: StoryView; stored: StorySettings }) {
  const [genre, setGenre] = useState<string | null>(null);
  const [theme, setTheme] = useState<string | null>(null);
  const [timezone, setTimezone] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const genreValue = genre ?? stored.preferredGenre ?? "";
  const themeValue = theme ?? stored.preferredTheme ?? "";
  const timezoneValue = timezone ?? stored.timezone ?? "";
  const thresholdValue = threshold ?? String(stored.furiganaThresholdSrsLevel);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    setSaved(false);
    const level = Number(thresholdValue);
    if (!Number.isInteger(level) || level < 1 || level > 9) {
      setError("The furigana threshold is a whole number from 1 to 9.");
      return;
    }
    setBusy(true);
    try {
      const res = await view.saveSettings({
        furiganaThresholdSrsLevel: level,
        preferredGenre: genreValue,
        preferredTheme: themeValue,
        timezone: timezoneValue,
      });
      if (res.ok) {
        setGenre(null);
        setTheme(null);
        setTimezone(null);
        setThreshold(null);
        setSaved(true);
      } else setError(res.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <form onSubmit={(e) => void save(e)}>
        <p>
          <label>
            Furigana threshold (SRS level 1–9)
            <input
              name="furiganaThreshold"
              type="number"
              min={1}
              max={9}
              step={1}
              value={thresholdValue}
              disabled={busy}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            Preferred genre
            <input
              name="preferredGenre"
              maxLength={60}
              placeholder="travel, mystery… empty = surprise me"
              value={genreValue}
              disabled={busy}
              onChange={(e) => setGenre(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            Preferred theme
            <input
              name="preferredTheme"
              maxLength={200}
              placeholder="a robot running a ramen shop — empty = none"
              value={themeValue}
              disabled={busy}
              onChange={(e) => setTheme(e.target.value)}
            />
          </label>
        </p>
        <p>
          <label htmlFor="story-timezone">
            Your timezone (decides which day your daily story belongs to)
          </label>
          <TimezoneAutocomplete
            id="story-timezone"
            value={timezoneValue}
            disabled={busy}
            onChange={setTimezone}
          />
        </p>
        <button type="submit" disabled={busy}>
          Save settings
        </button>
      </form>
      {saved && (
        <p className="saved" role="status">
          Saved — future stories will aim for these.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="muted">
        Genre and theme steer what the generator is asked for; the validation gate still has the last
        word, so a preference it cannot fill falls back rather than forcing a bad story. The furigana
        threshold applies when stories are read. Your timezone decides which local day each daily
        story belongs to — until you choose one, the server’s own day is used.
      </p>
    </>
  );
}
