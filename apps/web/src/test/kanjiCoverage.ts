// The furigana coverage rule (issue #125): on a screen rendered in
// ja-furigana, interface chrome may show kanji only inside <ruby>.
// Kanji outside ruby is allowed only where it is not chrome:
//   - inside <ruby> (either line: the <T> renderer's base or its <rt>),
//   - inside learning content marked lang="ja" (Story titles, exercise prompts,
//     the Appearance sample line) — but never the root element: the whole
//     document carries <html lang="ja">, so that exemption must not reach it,
//   - inside aria-hidden brand art (the 読 wordmark),
//   - in screen-reader-only text, which is never drawn and is rendered as plain
//     text precisely so a reader does not say the reading.
// Intl dates and times used to be exempt too ("2026年11月1日", no table
// reading); the date formatter now gives them real readings, so the exemption
// is gone and the test enforces that.
const KANJI = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/;

/** Every visible text node that shows kanji the furigana renderer did not touch. */
export function unrubyfiedKanji(container: HTMLElement): string[] {
  const offenders: string[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    if (!KANJI.test(text)) continue;
    const parent = (node as Text).parentElement;
    if (!parent) continue;
    if (parent.closest("ruby")) continue;
    if (parent.closest('[aria-hidden="true"]')) continue;
    if (parent.closest(".sr-only")) continue;
    const root = parent.ownerDocument.documentElement;
    const hit = parent.closest('[lang="ja"]');
    if (hit && hit !== root) continue;
    offenders.push(text.trim());
  }
  return offenders;
}
