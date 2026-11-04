// Furigana for Japanese text: a reading set above its base text in <ruby>, the
// reading in the furigana token size and colour. Text with no reading renders as
// a plain text node. Both pieces are React children, never markup from the data.
// Local to the Grammar screens for now; the Story reader (#77) may bring its own
// helper, and the two can be unified after it merges.

export interface RubyRun {
  /** The base text, as the data gave it. */
  text: string;
  /** The kana reading for the base text, when the data has one. */
  reading?: string;
}

export function Ruby({ runs }: { runs: RubyRun[] }) {
  return (
    <>
      {runs.map((run, i) =>
        run.reading ? (
          <ruby key={i}>
            {run.text}
            <rt className="text-furigana-m text-furigana">{run.reading}</rt>
          </ruby>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}
