// Renders one string-table entry in the Learner's Interface Language (issue #125).
// `t()` hands back base/reading segments; a reading becomes a <ruby> pair in the
// furigana token size — the same shape the Grammar screens' Ruby helper draws —
// and a segment without one is a plain text node. In English and plain Japanese
// there are no readings at all, so this is just the sentence.

import { useT, type StringKey, type TranslateParams, type RubyText, type InterfaceLanguage } from "@vjt/core";

export function TableText({ segments }: { segments: RubyText }) {
  return (
    <>
      {segments.map((segment, i) =>
        segment.ruby === undefined ? (
          segment.text
        ) : (
          <ruby key={i}>
            {segment.text}
            <rt className="text-furigana-m text-furigana">{segment.ruby}</rt>
          </ruby>
        ),
      )}
    </>
  );
}

/** One entry of the string table, in the Interface Language of the surrounding provider. */
export function T({ k, params }: { k: StringKey; params?: TranslateParams }) {
  const { t } = useT();
  return <TableText segments={t(k, params)} />;
}

/**
 * The English plural "s" passed as a translation param: Japanese counts carry no
 * ending, so the param exists only to keep English wording byte-identical.
 */
export function pluralEn(language: InterfaceLanguage, count: number): "s" | "" {
  return language === "en" && count !== 1 ? "s" : "";
}
