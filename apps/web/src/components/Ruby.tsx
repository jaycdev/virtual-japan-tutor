// Furigana for Japanese text: a reading set above its base text in <ruby>, the
// reading in the furigana token size and colour. Text with no reading renders as
// a plain text node. Both pieces are React children, never markup from the data.
// This is the one ruby markup in the app: the Grammar screens and the string
// table's <T> renderer (Text.tsx) both draw through it (issue #125 review nit).
// The Story reader draws its own ruby (StoryText.tsx, ADR-0010) and does not
// come through here, so the ui-ruby class on this element — the hook all
// interface-furigana CSS is scoped to — never touches Story text (review V1b).

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
          // V1: the base is wrapped in an inline-block span. Chromium still
          // justifies the base run under a longer reading even with
          // ruby-align: center (measured: 配色 widened to 26.3px per kanji);
          // an inline-block is an atomic inline, so it cannot be pulled apart
          // and the whole base sits centred instead. index.css pairs this with
          // ruby-overhang: auto. The text content is unchanged.
          <ruby key={i} className="ui-ruby">
            {/* text-decoration: inherit keeps an underline (a link, an error
                squiggle) running through the base even though the inline-block
                would otherwise start its own decoration. (#125 round-3 nit) */}
            <span className="inline-block [text-decoration:inherit]">{run.text}</span>
            {/* aria-hidden: the reading is a visual aid; a screen reader gets
                the base alone, not base+reading. (#125 round-3 nit) */}
            <rt aria-hidden="true" className="text-furigana-m text-furigana">{run.reading}</rt>
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
