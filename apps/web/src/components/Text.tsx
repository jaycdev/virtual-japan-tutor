// Renders one string-table entry in the Learner's Interface Language (issue #125).
// `t()` hands back base/reading segments; a reading becomes a <ruby> pair drawn
// by the same Ruby helper the Grammar screens use (one markup, review nit), and
// a segment without one is plain text. In English and plain Japanese there are
// no readings at all, so this is just the sentence.

import { useT, type StringKey, type TranslateParams, type RubyText } from "@vjt/core";

import { Ruby } from "./Ruby.tsx";

export function TableText({ segments }: { segments: RubyText }) {
  const runs = segments.map((segment) => ({ text: segment.text, reading: segment.ruby }));
  if (!segments.some((segment) => segment.ruby)) {
    // Nothing annotated (en, ja, kanji-free entries): the plain sentence,
    // exactly as it always rendered.
    return <Ruby runs={runs} />;
  }
  // A1 (round-4 review): ruby markup splits an accessible name into pieces —
  // "練習 を 始 める" — because each inline-block base ends a text run. So
  // when anything carries a reading, the drawn half is hidden from assistive
  // tech whole, and one sr-only span carries the sentence plain: one clean
  // name. select-none keeps that copy out of Ctrl+A, where the visible
  // words are already selected.
  return (
    <>
      <span aria-hidden="true">
        <Ruby runs={runs} />
      </span>
      <span className="sr-only select-none">{segments.map((segment) => segment.text).join("")}</span>
    </>
  );
}

/** One entry of the string table, in the Interface Language of the surrounding provider. */
export function T({ k, params }: { k: StringKey; params?: TranslateParams }) {
  const { t } = useT();
  return <TableText segments={t(k, params)} />;
}
