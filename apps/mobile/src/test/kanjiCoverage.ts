// The furigana coverage rule on the phone (issue #125). The web twin of this
// file asks whether kanji sits inside a <ruby>; RN has no ruby, so the
// question here is whether every interface kanji stands in a reading column —
// the pair `components/Text.tsx` and the core date helpers build: a reading
// slot carrying its own inline font size over its base. That inline size is
// the only marker the jsdom host gives us (RN's accessibility props render to
// no attributes here), and it says the reading came from the string table
// rather than from the Learner's own text.
//
// Kanji without a column is allowed only where it is not chrome:
//   - inside learning content the app never translates (Story titles), which
//     the caller names by its testID,
//   - inside the reading slot itself (a kanji reading is still a reading).
// Screen-reader-only text is never drawn and carries no kanji in ja-furigana —
// `tp` speaks plain Japanese, readings left out — so nothing to exempt there.
const KANJI = /[㐀-䶿一-鿿豈-﫿]/;

/** True when one of `el`'s direct children is a reading slot. */
function hasReadingSlot(el: Element): boolean {
  return Array.from(el.children).some((child) => child.getAttribute("style")?.includes("font-size"));
}

/** True when `el` itself, or its wrapper element, is the reading slot. */
function isReadingSlot(el: Element): boolean {
  return (
    el.getAttribute("style")?.includes("font-size") === true ||
    el.parentElement?.getAttribute("style")?.includes("font-size") === true
  );
}

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
    if (isReadingSlot(parent)) continue;
    // The base of an annotated unit: its column (directly, or one wrapper up
    // when the host nests a span inside the Text) holds the reading slot.
    const column = parent.parentElement;
    if (column && (hasReadingSlot(column) || (column.parentElement && hasReadingSlot(column.parentElement)))) {
      continue;
    }
    offenders.push(text.trim());
  }
  return offenders;
}
