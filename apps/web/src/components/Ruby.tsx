// Furigana for Japanese text: a reading set above its base text in <ruby>, the
// reading in the furigana token size and colour. Text with no reading renders as
// a plain text node. Both pieces are React children, never markup from the data.
// This is the one ruby markup in the app: the Grammar screens and the string
// table's <T> renderer (Text.tsx) both draw through it (issue #125 review nit).

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
          // A bare text node, not a wrapper span: the sentence stays one run of
          // text for queries and screen readers, exactly as before #125.
          run.text
        ),
      )}
    </>
  );
}
