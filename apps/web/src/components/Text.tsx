// Renders one string-table entry in the Learner's Interface Language (issue #125).
// `t()` hands back base/reading segments; a reading becomes a <ruby> pair drawn
// by the same Ruby helper the Grammar screens use (one markup, review nit), and
// a segment without one is plain text. In English and plain Japanese there are
// no readings at all, so this is just the sentence.

import { useT, type StringKey, type TranslateParams, type RubyText } from "@vjt/core";

import { Ruby } from "./Ruby.tsx";

export function TableText({ segments }: { segments: RubyText }) {
  return (
    <Ruby runs={segments.map((segment) => ({ text: segment.text, reading: segment.ruby }))} />
  );
}

/** One entry of the string table, in the Interface Language of the surrounding provider. */
export function T({ k, params }: { k: StringKey; params?: TranslateParams }) {
  const { t } = useT();
  return <TableText segments={t(k, params)} />;
}
