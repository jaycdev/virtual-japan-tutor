import type { ApiClient, Story as StoryData, StoryToken } from "@vjt/api-client";
import { useStory, type StoryView } from "@vjt/core";

/**
 * Stories (issue #10): read the Story the background generator has ready,
 * browse the Story Library, rate stories (thumbs up/down steer future
 * genres), and answer the comprehension questions — the first answer writes
 * Practice Records for the story's Focus Set items. Generation is never
 * triggered from this screen, so opening a story is instant.
 *
 * Sentences render token by token: the reading goes above the surface as
 * ruby text wherever the server's `showFurigana` says so (unknown tokens,
 * and Known Items below the Learner's Furigana Threshold), and Grammar
 * Spans underline the morphemes they cover.
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
      {view.open && view.story ? <StoryReader view={view} /> : <StoryLibrary view={view} />}
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

function StoryReader({ view }: { view: StoryView }) {
  const story = view.story as StoryData;
  return (
    <>
      <p>
        <button type="button" onClick={view.close}>
          ← Library
        </button>
      </p>
      <h3>
        {story.genre} <span className="muted">{new Date(story.createdAt).toDateString()}</span>
      </h3>
      <RatingButtons view={view} story={story} />
      {story.sentences.map((sen, i) => (
        <p key={i}>
          {sen.tokens.map((tok, j) => (
            <TokenText key={j} token={tok} spans={sen.grammarSpans ?? []} />
          ))}
          <br />
          <span className="muted">{sen.en}</span>
        </p>
      ))}
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
    </>
  );
}

/** One morpheme: ruby reading when the server asked for furigana, underlined when a Grammar Span covers it. */
function TokenText({ token, spans }: { token: StoryToken; spans: NonNullable<StoryData["sentences"][number]["grammarSpans"]> }) {
  const covered = spans.filter((sp) => token.start < sp.end && sp.start < token.end);
  const spanTitle = covered.map((sp) => `grammar point ${sp.grammarPointId}`).join(", ");
  const body =
    token.showFurigana && token.reading ? (
      <ruby>
        {token.surface}
        <rt>{token.reading}</rt>
      </ruby>
    ) : (
      token.surface
    );
  if (covered.length === 0) return <span>{body}</span>;
  return (
    <span className="grammar-span" title={spanTitle}>
      {body}
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
