import type {
  ApiClient,
  DictionaryEntry,
  GrammarPointDetail,
  PitchPattern,
  Story as StoryData,
  StoryGrammarSpan,
  StorySettings,
  StoryToken,
} from "@vjt/api-client";
import { useReadingSettings, useStory, type StoryView } from "@vjt/core";
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
 * Stories (issue #10): read the Story the background generator has ready,
 * browse the Story Library, rate stories (thumbs up/down steer future
 * genres), answer the comprehension questions — the first answer writes
 * Practice Records for the story's Focus Set items — and choose the story
 * settings (Furigana Threshold, preferred genre/theme). Generation is never
 * triggered from this screen, so opening a story is instant.
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
 * their own Dictionary Entry); Dictionary opens a Dictionary Entry window
 * with the full JMdict entry, the Learner's MaruMori state for the word and
 * each of its kanji, and the Kanjium pitch pattern when we have one.
 * Everything reachable by mouse is reachable by keyboard: tokens are
 * buttons, Enter opens the menu (which takes focus), Escape closes just the
 * menu — then the windows one at a time — and returns focus to the token.
 */
export function Stories({ client }: { client: ApiClient }) {
  const view = useStory(client);
  return (
    <section>
      <h2>Stories</h2>
      {view.error && (
        <p className="error" role="alert">
          {view.error}
        </p>
      )}
      {view.open && view.story ? <StoryReader view={view} client={client} /> : <StoryLibrary view={view} />}
      <StorySettingsForm view={view} />
    </section>
  );
}

function StoryLibrary({ view }: { view: StoryView }) {
  const lib = view.library;
  return (
    <>
      <p>
        <button type="button" disabled={view.pending} onClick={() => void view.openReady()}>
          Read today&apos;s story
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
        <ul className="story-list">
          {lib.page.items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => void view.openStory(s.id)}>
                {s.genre}
              </button>{" "}
              <span className="muted">{new Date(s.createdAt).toDateString()}</span>{" "}
              <RatingButtons view={view} story={s} />
            </li>
          ))}
        </ul>
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

/** What the Lookup row is describing right now: a hovered/focused word, or a Grammar Span. */
type HoverTarget = { kind: "token"; sentence: number; index: number } | { kind: "grammar"; sentence: number; index: number };

/** The token menu that is open (Dictionary · Save · Save to…), if any. */
type OpenMenu = { sentence: number; index: number };

/** An open Dictionary Entry or Grammar Point window. */
type OpenWindow =
  | { kind: "dictionary"; key: string; entSeq: number; surface: string; reading?: string }
  | { kind: "grammar"; key: string; grammarPointId: string };

function StoryReader({ view, client }: { view: StoryView; client: ApiClient }) {
  const story = view.story as StoryData;
  const reading = useReadingSettings(client);
  const lookup = useEntryLookup(client);
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [windows, setWindows] = useState<OpenWindow[]>([]);

  const openWindow = useCallback((w: OpenWindow) => {
    setWindows((prev) => (prev.some((x) => x.key === w.key) ? prev : [...prev, w]));
  }, []);

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
    setMenu({ sentence: sentenceIdx, index: tokenIdx });
  };

  const escape = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    // Escape peels one layer: it closes just the menu — focusing its token
    // button first, so focus is not dropped — and otherwise closes the most
    // recently opened window.
    if (menu) {
      const btn = document.querySelector<HTMLButtonElement>(`button[data-token="${menu.sentence}:${menu.index}"]`);
      btn?.focus();
      setMenu(null);
    } else if (windows.length > 0) {
      setWindows((prev) => prev.slice(0, -1));
    }
  };

  return (
    <section onKeyDown={escape}>
      <p>
        <button type="button" onClick={view.close}>
          ← Library
        </button>
      </p>
      <h3>
        {story.genre} <span className="muted">{new Date(story.createdAt).toDateString()}</span>
      </h3>
      <RatingButtons view={view} story={story} />

      <ReadingPanel story={story} selected={selected} hovered={hovered} lookup={lookup} reading={reading} />

      {story.sentences.map((sen, i) => (
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
                hovered={hovered?.kind === "token" && hovered.sentence === i && hovered.index === j}
                onEnter={() => {
                  setHovered({ kind: coveringSpan(sen, tok) ? "grammar" : "token", sentence: i, index: j });
                  if (coveringSpan(sen, tok) === null && tok.entSeq !== undefined) {
                    lookup.load(tok.entSeq, tok.surface, tok.reading);
                  }
                }}
                onLeave={() =>
                  setHovered((h) => (h && h.sentence === i && h.index === j ? null : h))
                }
                onActivate={() => onTokenActivate(i, j)}
                menu={
                  menu && menu.sentence === i && menu.index === j ? (
                    <TokenMenu
                      token={tok}
                      span={coveringSpan(sen, tok)}
                      onDictionary={() => {
                        if (tok.entSeq === undefined) return;
                        setMenu(null);
                        openWindow({
                          kind: "dictionary",
                          key: `entry-${tok.entSeq}-${tok.surface}`,
                          entSeq: tok.entSeq,
                          surface: tok.surface,
                          reading: tok.reading,
                        });
                      }}
                      onGrammar={() => {
                        const sp = coveringSpan(sen, tok);
                        if (!sp) return;
                        setMenu(null);
                        openWindow({ kind: "grammar", key: `grammar-${sp.grammarPointId}`, grammarPointId: sp.grammarPointId });
                      }}
                    />
                  ) : null
                }
              />
            )}
          />
        </p>
      ))}

      {windows.map((w) =>
        w.kind === "dictionary" ? (
          <DictionaryWindow
            key={w.key}
            client={client}
            entry={w}
            cached={lookup.peek(w.entSeq, w.surface, w.reading)}
            onClose={() => setWindows((prev) => prev.filter((x) => x.key !== w.key))}
          />
        ) : (
          <GrammarWindow
            key={w.key}
            client={client}
            grammarPointId={w.grammarPointId}
            onClose={() => setWindows((prev) => prev.filter((x) => x.key !== w.key))}
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
}: {
  story: StoryData;
  selected: number | null;
  hovered: HoverTarget | null;
  lookup: EntryLookup;
  reading: ReturnType<typeof useReadingSettings>;
}) {
  const blur = reading.state.status === "ready" ? reading.state.settings.blurTranslation : true;
  const sen = selected !== null ? story.sentences[selected] : null;

  // Two lines don't fit (long sentence, furigana ruby inflating the lines)?
  // Shrink the text exactly one step; if it still overflows, the area
  // scrolls. The inline ref callback is re-invoked on every render, so the
  // content is always re-measured against the CSS-fixed box height.
  return (
    <div className="reading-panel" aria-label="Reading Panel">
      <div
        className="sentence-area"
        ref={(el) => {
          if (el) el.classList.toggle("shrunk", el.scrollHeight > el.clientHeight);
        }}
      >
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
              onClick={() => void reading.setBlurTranslation(!blur)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void reading.setBlurTranslation(!blur);
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
      </div>
      <div className="lookup-row" aria-live="polite">
        {/* Fixed label, outside the conditional content: it keeps its slot so
            the row never shifts as lookups come and go. */}
        <span className="lookup-label">Word meaning</span>
        <LookupRow story={story} hovered={hovered} lookup={lookup} />
      </div>
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
 * for the point, keeping words inside spans reachable. Save / Save to…
 * arrive with Saved Items (issue #12). Opening moves focus to the first
 * enabled item.
 */
function TokenMenu({
  token,
  span,
  onDictionary,
  onGrammar,
}: {
  token: StoryToken;
  span: StoryGrammarSpan | null;
  onDictionary: () => void;
  onGrammar: () => void;
}) {
  const later = { disabled: true, title: "Saving words comes with Saved Items (issue #12)" } as const;
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const first = rootRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not([disabled])");
    first?.focus();
  }, []);
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
      <button type="button" role="menuitem" {...later}>
        Save
      </button>
      <button type="button" role="menuitem" {...later}>
        Save to…
      </button>
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
  const [data, setData] = useState<DictionaryEntry | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(cached === undefined);

  useEffect(() => {
    // Start with the cached entry when the hover already fetched it; otherwise
    // the window loads its own copy.
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
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, entry.entSeq, entry.surface, entry.reading, cached]);

  return (
    <section className="entry-window" aria-label={`Dictionary entry: ${entry.surface}`}>
      <p className="entry-head">
        <strong>{data?.headword ?? entry.surface}</strong>
        {data?.reading && data.reading !== data.headword && <span className="lookup-reading"> {data.reading}</span>}
        {data?.jlptLevel && <JlptBadge level={data.jlptLevel} />}
        <button type="button" aria-label="Close entry window" onClick={onClose}>
          ×
        </button>
      </p>
      {loading && <p className="muted">Loading entry…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data && !data.found && <p className="muted">The dictionary has no entry behind this word.</p>}
      {data && data.found && (
        <>
          {data.srsLevel !== null && (
            <p className="entry-srs">
              Known item — SRS Level {data.srsLevel}, Mastery {Math.round((data.mastery ?? 0) * 100)}%
            </p>
          )}
          <ol className="senses">
            {data.senses.map((sense, i) => (
              <li key={i}>
                {sense.partsOfSpeech.length > 0 && <em className="pos">{sense.partsOfSpeech.join(", ")} — </em>}
                {sense.glosses.join("; ")}
              </li>
            ))}
          </ol>
          {data.kanjiForms.length > 0 && <p className="forms">Kanji forms: {data.kanjiForms.join("、")}</p>}
          {data.readings.length > 0 && <p className="forms">Readings: {data.readings.join("、")}</p>}
          {data.pitch && (
            <p className="pitch-row">
              Pitch <PitchGraph pitch={data.pitch} />{" "}
              <span className="muted">
                {data.pitch.heiban ? "heiban (flat)" : `downstep after mora ${data.pitch.downstepAfterMora}`}
              </span>
            </p>
          )}
          {data.kanji.length > 0 && (
            <table className="kanji-table">
              <caption>Kanji in this word</caption>
              <tbody>
                {data.kanji.map((k) => (
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
 * and the Dictionary window then need no new request.
 */
interface EntryLookup {
  load(entSeq: number, surface?: string, reading?: string): void;
  peek(entSeq: number, surface?: string, reading?: string): DictionaryEntry | undefined;
}

function useEntryLookup(client: ApiClient): EntryLookup {
  const [cache, setCache] = useState<Map<string, DictionaryEntry>>(() => new Map());
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
          if (data) setCache((prev) => new Map(prev).set(k, data));
        } catch {
          /* the Lookup row simply stays empty; the window shows the error */
        } finally {
          inflight.current.delete(k);
        }
      })();
    },
    [client, cache],
  );

  const peek = useCallback((entSeq: number, surface?: string, reading?: string) => cache.get(key(entSeq, surface, reading)), [cache]);

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

/** The Furigana Threshold and preferred genre/theme, steering future stories. */
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
  const [threshold, setThreshold] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [saved, setSaved] = useState(false);

  const genreValue = genre ?? stored.preferredGenre ?? "";
  const themeValue = theme ?? stored.preferredTheme ?? "";
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
      });
      if (res.ok) {
        setGenre(null);
        setTheme(null);
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
        threshold applies when stories are read.
      </p>
    </>
  );
}
