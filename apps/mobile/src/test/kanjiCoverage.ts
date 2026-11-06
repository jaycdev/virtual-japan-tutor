// The furigana coverage rule on the phone (issue #125). The web twin of this
// file asks whether kanji sits inside a <ruby>; RN has no ruby, so the
// question here is whether every interface kanji stands in a reading column.
// The renderer marks its own columns — components/Text.tsx tags each annotated
// cell `furigana-base` and the reading slot inside it `furigana-reading` —
// and only those markers count: a kanji is covered when it sits in a base
// cell that holds a reading slot. Inline font sizes and generic wrappers
// prove nothing; the reader sets those for Learner text too.
//
// Kanji without a column is allowed only where it is not chrome:
//   - inside learning content the app never translates (Story titles, the
//     practice prompt), which the caller names by its testID,
//   - inside the reading slot itself (a kanji reading is still a reading).
// Screen-reader-only text is never drawn and carries no kanji in ja-furigana —
// `tp` speaks plain Japanese, readings left out — so nothing to exempt there.
const KANJI = /[㐀-䶿一-鿿豈-﫿]/;

/** Every visible text node that shows kanji the furigana renderer did not give a reading. */
export function unrubyfiedKanji(container: HTMLElement, learningContentTestIds: string[] = []): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!KANJI.test(text)) continue;
    const parent = (node as Text).parentElement;
    if (!parent) continue;
    if (learningContentTestIds.some((id) => parent.closest(`[data-testid="${id}"]`))) continue;
    if (parent.closest('[data-testid="furigana-reading"]')) continue;
    // The base of an annotated unit: the marked cell holds its reading slot.
    const cell = parent.closest('[data-testid="furigana-base"]');
    if (cell?.querySelector('[data-testid="furigana-reading"]')) continue;
    offenders.push(text.trim());
  }
  return offenders;
}
