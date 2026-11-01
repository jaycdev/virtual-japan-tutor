import type { ApiClient, GenerationResult, GrammarPointDetail } from "@vjt/api-client";
import {
  useGrammar,
  type ActionResult,
  type GenerateOutcome,
  type Grammar,
  type GrammarLevelFilter,
} from "@vjt/core";
import { useState } from "react";

const LEVELS: GrammarLevelFilter[] = ["all", "N5", "N4", "N3", "N2", "N1"];
const COUNTS = [5, 10, 20];

/** Runs a mutating action and hands back its (typed) outcome. */
type RunAction = <T extends ActionResult>(action: () => Promise<T>) => Promise<T>;

/** The grammar catalogue: level filter and search, and per point an explanation and validated examples. */
export function Grammar({ client }: { client: ApiClient }) {
  const grammar = useGrammar(client);
  const { state, detail } = grammar;
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  /** Runs a mutating action, surfacing its failure message. */
  const run = async <T extends ActionResult>(action: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setError(undefined);
    try {
      const res = await action();
      if (!res.ok) setError(res.message);
      return res;
    } finally {
      setBusy(false);
    }
  };

  if (state.status === "loading") return <p>Loading…</p>;
  if (state.status === "error") {
    return (
      <>
        <p>Cannot load grammar points: {state.message}</p>
        <button type="button" onClick={grammar.reload}>
          Retry
        </button>
      </>
    );
  }

  return (
    <section>
      <h2>Grammar</h2>
      {error && <p role="alert">{error}</p>}
      {detail.status === "idle" && <PointList grammar={grammar} />}
      {detail.status !== "idle" && <PointDetail grammar={grammar} run={run} busy={busy} />}
    </section>
  );
}

function PointList({ grammar }: { grammar: Grammar }) {
  const { state, filter } = grammar;
  if (state.status !== "ready") return null;
  const page = state.page;
  const from = page.items.length === 0 ? 0 : page.offset + 1;
  const to = page.offset + page.items.length;
  return (
    <>
      <p>
        <label>
          Level{" "}
          <select aria-label="Level" value={filter.level} onChange={(e) => grammar.setLevel(e.target.value as GrammarLevelFilter)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l === "all" ? "All levels" : l}
              </option>
            ))}
          </select>
        </label>{" "}
        <label>
          Search{" "}
          <input value={filter.query} placeholder="pattern or meaning" onChange={(e) => grammar.setQuery(e.target.value)} />
        </label>
      </p>
      {page.items.length === 0 ? (
        <p>No grammar points match.</p>
      ) : (
        <ul>
          {page.items.map((p) => (
            <li key={`${p.jlptLevel}-${p.id}`}>
              <button type="button" onClick={() => grammar.open(p.id)}>
                {p.pattern}
              </button>{" "}
              <span>
                {p.jlptLevel} · {p.meaning} · {p.exampleCount} examples ·{" "}
                {p.hasExplanation ? "explanation ready" : "no explanation yet"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p>
        <button type="button" disabled={page.offset === 0} onClick={() => grammar.setOffset(page.offset - page.limit)}>
          Previous
        </button>{" "}
        <span>
          {from}–{to} of {page.total}
        </span>{" "}
        <button type="button" disabled={to >= page.total} onClick={() => grammar.setOffset(page.offset + page.limit)}>
          Next
        </button>
      </p>
    </>
  );
}

function PointDetail({ grammar, run, busy }: { grammar: Grammar; run: RunAction; busy: boolean }) {
  const { detail } = grammar;
  if (detail.status === "idle" || detail.status === "loading") return <p>Loading…</p>;
  if (detail.status === "error") {
    return (
      <>
        <p>Cannot load this grammar point: {detail.message}</p>
        <button type="button" onClick={grammar.close}>
          Back to list
        </button>
      </>
    );
  }
  return <PointReady grammar={grammar} point={detail.point} run={run} busy={busy} />;
}

function PointReady({
  grammar,
  point,
  run,
  busy,
}: {
  grammar: Grammar;
  point: GrammarPointDetail;
  run: RunAction;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(point.explanation);
  const [count, setCount] = useState(5);
  const [generation, setGeneration] = useState<GenerationResult | null>(null);
  // Adopt the server's copy after a save or regeneration (render-time reset,
  // the pattern React prescribes for prop-derived state).
  const [adopted, setAdopted] = useState(point.explanation);
  if (point.explanation !== adopted) {
    setAdopted(point.explanation);
    setDraft(point.explanation);
  }

  const generate = async () => {
    setGeneration(null);
    const res: GenerateOutcome = await run(() => grammar.generateExamples(point.id, count));
    if (res.ok) setGeneration(res.result);
  };

  return (
    <div>
      <button type="button" onClick={grammar.close}>
        Back to list
      </button>
      <h3>
        {point.pattern} <small>({point.jlptLevel} · #{point.catalogueNumber})</small>
      </h3>
      <p>
        {point.meaning}
        {point.variants.length > 0 && <> · variants: {point.variants.join(", ")}</>}
      </p>

      <p>
        <label>
          Explanation{" "}
          <textarea name="explanation" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
        </label>
      </p>
      <p>
        <button
          type="button"
          disabled={busy || draft.trim() === "" || draft === point.explanation}
          onClick={() => void run(() => grammar.saveExplanation(point.id, draft))}
        >
          Save explanation
        </button>{" "}
        <button type="button" disabled={busy} onClick={() => void run(() => grammar.regenerateExplanation(point.id))}>
          Regenerate explanation
        </button>
      </p>
      {point.explanationEdited && <p role="status">You have edited this explanation.</p>}
      {point.explanation === "" && !point.explanationEdited && <p>No explanation yet. Regenerate one or write your own.</p>}

      <h4>Example sentences</h4>
      {point.examples.length === 0 ? (
        <p>No validated examples yet.</p>
      ) : (
        <ul>
          {point.examples.map((ex) => (
            <li key={ex.id}>
              <Sentence sentenceJa={ex.sentenceJa} spanStart={ex.spanStart} spanEnd={ex.spanEnd} />{" "}
              <span className="translation">{ex.translationEn}</span>
            </li>
          ))}
        </ul>
      )}
      <p>
        <label>
          Count{" "}
          <select aria-label="Count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {COUNTS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>{" "}
        <button type="button" disabled={busy} onClick={() => void generate()}>
          Generate examples
        </button>
      </p>
      {generation && (
        <>
          <p role="status">
            Added {generation.stored} · rejected {generation.rejected} candidates.
            {generation.note && <> {generation.note}</>}
          </p>
          {generation.rejections.length > 0 && (
            <ul>
              {generation.rejections.map((r, i) => (
                <li key={`${r.code}-${i}`}>
                  {r.sentence && <strong>{r.sentence} </strong>}
                  {r.message} <small>({r.code})</small>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Renders a sentence with its Grammar Span marked. Offsets are rune-based, so split on code points. */
function Sentence({ sentenceJa, spanStart, spanEnd }: { sentenceJa: string; spanStart: number; spanEnd: number }) {
  const chars = Array.from(sentenceJa);
  return (
    <span>
      {chars.slice(0, spanStart).join("")}
      <mark>{chars.slice(spanStart, spanEnd).join("")}</mark>
      {chars.slice(spanEnd).join("")}
    </span>
  );
}
