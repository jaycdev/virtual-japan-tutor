// Furigana for Japanese text: a reading set above its base text in <ruby>.
// Text with no reading renders as a plain text node. Both pieces are React
// children, never markup from the data.
// This is the one ruby markup in the app: the Grammar screens and the string
// table's <T> renderer (Text.tsx) both draw through it. The Story reader draws
// its own ruby (StoryText.tsx, ADR-0010) and does not come through here, so
// the ui-ruby class on this element — the hook all interface-furigana CSS is
// scoped to — never touches Story text.

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
          // Base in an inline-block: Chromium otherwise spreads it under a longer reading.
          <ruby key={i} className="ui-ruby">
            <span className="inline-block [text-decoration:inherit]">{run.text}</span>
            {/* A visual aid: a screen reader gets the base alone, not base+reading. */}
            <rt aria-hidden="true" className="text-furigana-m text-furigana">{run.reading}</rt>
          </ruby>
        ) : (
          // A bare text node, not a wrapper span: the sentence stays one run of
          // text for queries and screen readers.
          run.text
        ),
      )}
    </>
  );
}
